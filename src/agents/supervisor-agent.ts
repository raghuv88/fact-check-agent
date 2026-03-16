import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
import { Claim, VerificationResult } from "../types.js";
import { tools, executeTool } from "../tools/index.js";

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ============================================
// SUPERVISOR AGENT
// ============================================

interface VerificationPlan {
  claim_id: string;
  strategy: "simple" | "thorough" | "expert_needed";
  search_queries: string[];
  reasoning: string;
}

interface SupervisorResponse {
  plans: VerificationPlan[];
  overall_approach: string;
}

/**
 * Supervisor Agent: Plans verification strategy for all claims
 */
export async function createVerificationPlan(
  claims: Claim[],
): Promise<SupervisorResponse> {
  console.log("\n🎯 SUPERVISOR AGENT: Creating verification plan");
  console.log("=".repeat(60));

  const systemPrompt = `You are a Supervisor Agent for fact-checking.

Your job: Analyze claims and create a verification strategy for each.

For each claim, decide:
1. Strategy:
   - "simple": Straightforward fact (date, name, location) - 1-2 searches
   - "thorough": Complex claim needing multiple sources - 3-5 searches
   - "expert_needed": Requires domain expertise, nuanced - 5+ searches

2. Search queries: Specific queries that will find relevant evidence

Output ONLY valid JSON:
{
  "overall_approach": "Brief strategy overview",
  "plans": [
    {
      "claim_id": "claim_1",
      "strategy": "simple | thorough | expert_needed",
      "search_queries": ["query1", "query2"],
      "reasoning": "Why this strategy"
    }
  ]
}

CRITICAL: Return ONLY the JSON object. No markdown, no commentary.`;

  const claimsSummary = claims.map((c) => `${c.id}: "${c.claim}"`).join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Create verification plans for these claims:\n\n${claimsSummary}`,
      },
    ],
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );

  if (!textBlock) {
    throw new Error("No response from supervisor");
  }

  const cleaned = cleanJsonResponse(textBlock.text);
  const plan: SupervisorResponse = JSON.parse(cleaned);

  console.log(`📋 Created ${plan.plans.length} verification plans`);
  plan.plans.forEach((p) => {
    console.log(
      `   • ${p.claim_id}: ${p.strategy} (${p.search_queries.length} queries)`,
    );
  });

  return plan;
}

/**
 * Supervisor Agent: Reviews worker results and makes final decision
 */
export async function supervisorReview(
  claim: Claim,
  searchResults: string[],
  workerVerdict: VerificationResult,
): Promise<VerificationResult> {
  console.log(`\n🔍 SUPERVISOR: Reviewing verification for ${claim.id}`);

  const systemPrompt = `You are a Supervisor reviewing fact-check results.

Your job: Review the worker's verdict and either approve or override it.

Consider:
- Quality of evidence
- Consistency across sources
- Worker's reasoning
- Confidence level appropriateness

Output ONLY valid JSON:
{
  "approved": true | false,
  "final_verdict": "TRUE | FALSE | PARTIALLY_TRUE | UNVERIFIABLE | NEEDS_CONTEXT",
  "final_confidence": "HIGH | MEDIUM | LOW",
  "supervisor_notes": "Your reasoning for approval/override",
  "final_explanation": "Final explanation to user"
}

CRITICAL: Return ONLY the JSON object. No markdown, no commentary.`;

  const reviewInput = {
    claim: claim.claim,
    worker_verdict: workerVerdict.verdict,
    worker_confidence: workerVerdict.confidence,
    worker_explanation: workerVerdict.explanation,
    search_results: searchResults,
  };

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Review this verification:\n\n${JSON.stringify(reviewInput, null, 2)}`,
      },
    ],
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );

  if (!textBlock) {
    return workerVerdict; // Fallback to worker's decision
  }

  const cleaned = cleanJsonResponse(textBlock.text);
  const review = JSON.parse(cleaned);

  if (review.approved) {
    console.log(`   ✅ Approved worker's verdict: ${workerVerdict.verdict}`);
    return workerVerdict;
  } else {
    console.log(
      `   ⚠️  Overriding: ${workerVerdict.verdict} → ${review.final_verdict}`,
    );
    return {
      ...workerVerdict,
      verdict: review.final_verdict,
      confidence: review.final_confidence,
      explanation: review.final_explanation,
    };
  }
}

// ============================================
// SPECIALIZED WORKER AGENTS
// ============================================

/**
 * Worker: Simple Fact Checker (for straightforward claims)
 */
export async function simpleFactWorker(
  claim: Claim,
  searchQueries: string[],
): Promise<VerificationResult> {
  console.log(`\n👷 SIMPLE WORKER: Verifying ${claim.id}`);

  const systemPrompt = `You are a Simple Fact Verification Worker.

Your job: Verify straightforward factual claims using search results.

Focus on:
- Direct matches in search results
- Authoritative sources
- Clear yes/no answers

Output ONLY valid JSON (same format as before).

CRITICAL: Return ONLY the JSON object. No markdown, no commentary.`;

  return await executeWorker(claim, searchQueries, systemPrompt);
}

/**
 * Worker: Thorough Researcher (for complex claims)
 */
export async function thoroughResearchWorker(
  claim: Claim,
  searchQueries: string[],
): Promise<VerificationResult> {
  console.log(`\n🔬 THOROUGH WORKER: Deep research on ${claim.id}`);

  const systemPrompt = `You are a Thorough Research Worker.

Your job: Conduct deep research on complex claims.

Your approach:
- Cross-reference multiple sources
- Look for consensus vs. disagreement
- Consider context and nuance
- Note any caveats or limitations

Output ONLY valid JSON (same format as before).

CRITICAL: Return ONLY the JSON object. No markdown, no commentary.`;

  return await executeWorker(claim, searchQueries, systemPrompt);
}

/**
 * Worker: Expert Analyst (for nuanced claims)
 */
export async function expertAnalystWorker(
  claim: Claim,
  searchQueries: string[],
): Promise<VerificationResult> {
  console.log(`\n🎓 EXPERT WORKER: Expert analysis for ${claim.id}`);

  const systemPrompt = `You are an Expert Analyst Worker.

Your job: Analyze claims requiring domain expertise or nuanced understanding.

Your approach:
- Consider multiple interpretations
- Evaluate source credibility carefully
- Identify assumptions and context
- Provide balanced, nuanced verdict

Output ONLY valid JSON (same format as before).

CRITICAL: Return ONLY the JSON object. No markdown, no commentary.`;

  return await executeWorker(claim, searchQueries, systemPrompt);
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function executeWorker(
  claim: Claim,
  searchQueries: string[],
  systemPrompt: string,
): Promise<VerificationResult> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Verify this claim using these search queries:\n\nClaim: "${claim.claim}"\n\nSearch queries: ${searchQueries.join(", ")}`,
    },
  ];

  let searchResults: string[] = [];

  // Execute searches
  for (const query of searchQueries) {
    const result = await executeTool("search_web", { query });
    searchResults.push(result);
  }

  // Add search results to context
  messages.push({
    role: "user",
    content: `Search results:\n\n${searchResults.join("\n\n---\n\n")}`,
  });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages,
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );

  if (!textBlock) {
    throw new Error("No response from worker");
  }

  const cleaned = cleanJsonResponse(textBlock.text);
  const result = JSON.parse(cleaned);

  return {
    claim_id: claim.id,
    claim: claim.claim,
    verdict: result.verdict,
    confidence: result.confidence,
    explanation: result.explanation,
    evidence: result.evidence || [],
    search_queries_used: searchQueries,
    verification_timestamp: new Date().toISOString(),
  };
}

function cleanJsonResponse(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json\s*/i, "");
  cleaned = cleaned.replace(/^```\s*/i, "");
  cleaned = cleaned.replace(/\s*```$/i, "");
  return cleaned.trim();
}

// ============================================
// SUPERVISOR ORCHESTRATION
// ============================================

/**
 * Main orchestration function using Supervisor pattern
 */
export async function SupervisedMode(
  claims: Claim[],
): Promise<VerificationResult[]> {
  console.log("\n🎬 SUPERVISOR MODE: Starting verification");
  console.log("=".repeat(60));

  // Step 1: Supervisor creates plan
  const supervisorPlan = await createVerificationPlan(claims);
  console.log(`\n📋 Strategy: ${supervisorPlan.overall_approach}`);

  const results: VerificationResult[] = [];

  // Step 2: Delegate to workers based on strategy
  for (const plan of supervisorPlan.plans) {
    const claim = claims.find((c) => c.id === plan.claim_id);
    if (!claim) continue;

    let workerResult: VerificationResult;

    // Select appropriate worker
    switch (plan.strategy) {
      case "simple":
        workerResult = await simpleFactWorker(claim, plan.search_queries);
        break;
      case "thorough":
        workerResult = await thoroughResearchWorker(claim, plan.search_queries);
        break;
      case "expert_needed":
        workerResult = await expertAnalystWorker(claim, plan.search_queries);
        break;
      default:
        workerResult = await simpleFactWorker(claim, plan.search_queries);
    }

    // Step 3: Supervisor reviews worker's result
    const searchResults = workerResult.search_queries_used.map(
      (q) => `Query: ${q}`,
    );
    const finalResult = await supervisorReview(
      claim,
      searchResults,
      workerResult,
    );

    results.push(finalResult);
  }

  return results;
}
