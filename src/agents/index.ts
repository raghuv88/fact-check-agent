import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
import {
  Claim,
  ClaimExtractionResult,
  VerificationResult,
  FactCheckReport,
  VerificationVerdict,
  ConfidenceLevel,
  AgentType,
} from "../types.js";
import { tools, executeTool } from "../tools/index.js";
import { TokenTracker } from "../middleware/tokenTracker.js";
import {
  hashClaim,
  getCachedClaim,
  saveCachedClaim,
  recordCacheHit,
} from "../db/repository.js";

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Helper: Clean JSON response (remove markdown code blocks)
 */
function cleanJsonResponse(text: string): string {
  let cleaned = text.trim();

  // Remove markdown code blocks
  cleaned = cleaned.replace(/^```json\s*/i, "");
  cleaned = cleaned.replace(/^```\s*/i, "");
  cleaned = cleaned.replace(/\s*```$/i, "");
  cleaned = cleaned.trim();

  // Extract JSON object if the response has leading/trailing prose
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  return cleaned;
}

const MODEL = "claude-sonnet-4-20250514";

/**
 * Helper: Run agentic loop with tool support.
 * Accumulates token usage across all iterations and records one step entry
 * on the tracker when provided.
 */
async function runAgenticLoop(
  systemPrompt: string,
  userMessage: string,
  maxIterations: number = 5,
  trackerContext?: { tracker: TokenTracker; stepName: string; agentType: AgentType },
): Promise<string> {
  const loopStart = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: userMessage,
    },
  ];

  let response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    tools: tools,
    messages: messages,
  });

  totalInputTokens += response.usage.input_tokens;
  totalOutputTokens += response.usage.output_tokens;

  let iterationCount = 0;

  while (
    response.stop_reason === "tool_use" &&
    iterationCount < maxIterations
  ) {
    iterationCount++;

    // Get all tool use blocks
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) break;

    // Add assistant's response
    messages.push({
      role: "assistant",
      content: response.content,
    });

    // Execute all tools
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUseBlock of toolUseBlocks) {
      const toolResult = await executeTool(
        toolUseBlock.name,
        toolUseBlock.input as Record<string, any>,
      );

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUseBlock.id,
        content: toolResult,
      });
    }

    // Add all tool results
    messages.push({
      role: "user",
      content: toolResults,
    });

    // Get next response
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools: tools,
      messages: messages,
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
  }

  // Record aggregated token usage for this step
  if (trackerContext) {
    trackerContext.tracker.record({
      step: trackerContext.stepName,
      agentType: trackerContext.agentType,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      model: MODEL,
      durationMs: Date.now() - loopStart,
    });
  }

  // Extract final text
  const finalTextBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );

  return finalTextBlock?.text || "No response generated";
}

/**
 * AGENT 1: Claim Extractor
 * Extracts all factual claims from article text
 */
export async function extractClaims(
  articleText: string,
  tracker?: TokenTracker,
): Promise<ClaimExtractionResult> {
  console.log("\n🔍 AGENT 1: CLAIM EXTRACTOR");
  console.log("=".repeat(60));

  const systemPrompt = `You are a Claim Extraction Agent.

Extract all distinct factual claims from the given text and categorize each as:
- VERIFIABLE: Can be checked against sources (dates, facts, statistics, events, quotes)
- OPINION: Value judgments, preferences, predictions, subjective statements
- AMBIGUOUS: Unclear, missing details, vague, or depends on undefined terms

Rules:
- Extract claims even if likely false
- Split compound claims into atomic claims
- For quotes, attribute to the speaker
- If fact + opinion, split them

Output ONLY valid JSON in this format:
{
  "claims": [
    {
      "id": "claim_1",
      "claim": "The exact claim as a sentence",
      "category": "VERIFIABLE | OPINION | AMBIGUOUS",
      "reason": "Brief explanation",
      "source_reference": "Quote from original text"
    }
  ],
  "total_count": number
}`;

  const response = await runAgenticLoop(
    systemPrompt,
    `Extract all claims from this article:\n\n${articleText}`,
    5,
    tracker ? { tracker, stepName: 'Extract Claims', agentType: 'claim_extractor' } : undefined,
  );

  try {
    // Clean the response before parsing
    const cleanedResponse = cleanJsonResponse(response);
    const parsed = JSON.parse(cleanedResponse);
    const result: ClaimExtractionResult = {
      article_text: articleText.substring(0, 500) + "...",
      claims: parsed.claims,
      total_count: parsed.total_count,
      extraction_timestamp: new Date().toISOString(),
    };

    console.log(`✅ Extracted ${result.total_count} claims`);
    result.claims.forEach((claim, idx) => {
      const emoji =
        claim.category === "VERIFIABLE"
          ? "✓"
          : claim.category === "OPINION"
            ? "💭"
            : "❓";
      console.log(
        `   ${emoji} ${idx + 1}. [${claim.category}] ${claim.claim.substring(0, 60)}...`,
      );
    });

    return result;
  } catch (error) {
    console.error("❌ Failed to parse claim extraction:", error);
    throw new Error("Claim extraction failed");
  }
}

/**
 * AGENT 2: Fact Verifier
 * Verifies a single claim using web search
 */
export async function verifyClaim(
  claim: Claim,
  tracker?: TokenTracker,
  claimIndex?: number,
): Promise<VerificationResult> {
  console.log(`\n🔎 AGENT 2: FACT VERIFIER - Verifying claim ${claim.id}`);
  console.log("=".repeat(60));
  console.log(`Claim: "${claim.claim}"`);

  const systemPrompt = `You are a Fact Verification Agent.

Given a claim, verify it by searching the web for evidence.

Steps:
1. Search for relevant information (use multiple searches if needed)
2. Evaluate evidence quality and reliability
3. Determine verdict: TRUE, FALSE, PARTIALLY_TRUE, UNVERIFIABLE, or NEEDS_CONTEXT
4. Assess confidence: HIGH, MEDIUM, or LOW

Output ONLY valid JSON:
{
  "verdict": "TRUE | FALSE | PARTIALLY_TRUE | UNVERIFIABLE | NEEDS_CONTEXT",
  "confidence": "HIGH | MEDIUM | LOW",
  "explanation": "Clear explanation of your reasoning with specific evidence",
  "evidence": [
    {
      "snippet": "Relevant quote or fact from search",
      "url": "Source URL if available",
      "relevance": "HIGH | MEDIUM | LOW"
    }
  ],
  "search_queries_used": ["query1", "query2"]
}

CRITICAL: Return ONLY the JSON object. Do NOT wrap it in markdown code blocks. Do NOT include any explanation before or after the JSON.`;

  const stepName = claimIndex !== undefined ? `Verify Claim ${claimIndex}` : `Verify ${claim.id}`;
  const response = await runAgenticLoop(
    systemPrompt,
    `Verify this claim: "${claim.claim}"`,
    5,
    tracker ? { tracker, stepName, agentType: 'verifier' } : undefined,
  );

  try {
    // Clean the response before parsing
    const cleanedResponse = cleanJsonResponse(response);
    const parsed = JSON.parse(cleanedResponse);
    const result: VerificationResult = {
      claim_id: claim.id,
      claim: claim.claim,
      verdict: parsed.verdict as VerificationVerdict,
      confidence: parsed.confidence as ConfidenceLevel,
      explanation: parsed.explanation,
      evidence: parsed.evidence || [],
      search_queries_used: parsed.search_queries_used || [],
      verification_timestamp: new Date().toISOString(),
    };

    console.log(
      `✅ Verdict: ${result.verdict} (${result.confidence} confidence)`,
    );
    console.log(`   Searches: ${result.search_queries_used.length}`);

    return result;
  } catch (error) {
    console.error("❌ Failed to parse verification result:", error);
    throw new Error("Verification failed");
  }
}

/**
 * AGENT 3: Report Generator
 * Creates a comprehensive fact-check report
 */
export async function generateReport(
  extractionResult: ClaimExtractionResult,
  verificationResults: VerificationResult[],
  tracker?: TokenTracker,
): Promise<FactCheckReport> {
  console.log("\n📊 AGENT 3: REPORT GENERATOR");
  console.log("=".repeat(60));

  const systemPrompt = `You are a Report Generation Agent.

Given claim extraction and verification results, create a comprehensive, readable fact-check report.

Include:
1. Executive summary
2. Breakdown of claims by category
3. Key findings
4. Detailed verification results
5. Overall assessment

Be clear, concise, and objective. Highlight important findings.

Output ONLY valid JSON:
{
  "summary": "2-3 paragraph executive summary of findings"
}

CRITICAL: Return ONLY the JSON object. Do NOT wrap it in markdown code blocks. Do NOT include any explanation before or after the JSON.`;

  const input = {
    extraction: extractionResult,
    verifications: verificationResults,
  };

  const response = await runAgenticLoop(
    systemPrompt,
    `Generate a fact-check report summary for:\n\n${JSON.stringify(input, null, 2)}`,
    5,
    tracker ? { tracker, stepName: 'Generate Report', agentType: 'report_generator' } : undefined,
  );

  try {
    // Clean the response before parsing
    const cleanedResponse = cleanJsonResponse(response);
    const parsed = JSON.parse(cleanedResponse);

    const report: FactCheckReport = {
      article_preview: extractionResult.article_text,
      total_claims: extractionResult.total_count,
      verifiable_claims: extractionResult.claims.filter(
        (c) => c.category === "VERIFIABLE",
      ).length,
      opinion_claims: extractionResult.claims.filter(
        (c) => c.category === "OPINION",
      ).length,
      ambiguous_claims: extractionResult.claims.filter(
        (c) => c.category === "AMBIGUOUS",
      ).length,
      verification_results: verificationResults,
      summary: parsed.summary,
      generated_at: new Date().toISOString(),
    };

    console.log("✅ Report generated successfully");

    return report;
  } catch (error) {
    console.error("❌ Failed to generate report:", error);
    throw new Error("Report generation failed");
  }
}

/**
 * Cache-aware wrapper around verifyClaim.
 *
 * On a cache hit  — returns the stored result instantly (0 LLM tokens consumed).
 * On a cache miss — runs the full verifyClaim agent, then persists the result.
 */
export async function verifyClaimWithCache(
  claim: Claim,
  tracker?: TokenTracker,
  claimIndex?: number,
): Promise<VerificationResult> {
  const claimHash = hashClaim(claim.claim);
  const cached = getCachedClaim(claimHash);

  if (cached) {
    console.log(`  💾 CACHE HIT: claim "${claim.claim.substring(0, 60)}..."`);

    const stepName = claimIndex !== undefined ? `Verify Claim ${claimIndex}` : `Verify ${claim.id}`;

    if (tracker) {
      tracker.record({
        step: stepName,
        agentType: 'verifier',
        inputTokens: 0,
        outputTokens: 0,
        model: MODEL,
        durationMs: 0,
        cacheHit: true,
      });
    }

    recordCacheHit(claimHash, cached.tokensPerVerification ?? 0);

    return {
      claim_id: claim.id,
      claim: claim.claim,
      verdict: cached.verdict as VerificationVerdict,
      confidence: cached.confidence as ConfidenceLevel,
      explanation: cached.explanation,
      evidence: JSON.parse(cached.evidence),
      search_queries_used: [],
      verification_timestamp: new Date().toISOString(),
      from_cache: true,
    };
  }

  // Cache miss — run actual LLM verification
  const result = await verifyClaim(claim, tracker, claimIndex);

  // Determine tokens used from the last tracker step (set as savings baseline)
  let tokensUsed = 0;
  if (tracker) {
    const steps = tracker.getSummary().steps;
    const lastStep = steps[steps.length - 1];
    if (lastStep) tokensUsed = lastStep.tokens.total;
  }

  try {
    saveCachedClaim(claim.claim, result, tokensUsed);
  } catch (err) {
    // Unique constraint violation means another concurrent request already cached it — safe to ignore
    console.warn('  ⚠️  Cache insert skipped (already cached):', (err as Error).message);
  }

  return result;
}
