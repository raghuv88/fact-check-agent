import * as fs from "fs";
import * as path from "path";
import { extractClaims, verifyClaimWithCache, generateReport } from "./agents/index.js";
import { resolveReferences } from "./agents/referenceResolver.js";
import { FactCheckReport, VerificationResult } from "./types.js";
import { TokenTracker } from "./middleware/tokenTracker.js";
import { preprocessClaims, saveClaimVector } from "./preprocessing/index.js";

/**
 * Main orchestrator: Coordinates all agents to fact-check an article
 */
export async function factCheckArticle(
  articleText: string,
): Promise<FactCheckReport> {
  console.log("\n" + "=".repeat(80));
  console.log("🤖 MULTI-AGENT FACT-CHECKER STARTING");
  console.log("=".repeat(80));

  const startTime = Date.now();

  const tracker = new TokenTracker();

  try {
    // STEP 1: Extract claims from article
    console.log("\n📋 Step 1/5: Extracting claims...");
    const extractionResult = await extractClaims(articleText, tracker);

    console.log(`\n✓ Found ${extractionResult.total_count} total claims`);

    // STEP 2: Resolve references (pronouns, aliases, descriptive references)
    console.log("\n🔗 Step 2/5: Resolving references...");
    const { resolvedClaims, entityMap } = await resolveReferences(
      { articleText, claims: extractionResult.claims },
      tracker,
    );

    const resolvedCount = resolvedClaims.filter((c) => c.resolutionsApplied.length > 0).length;
    console.log(
      `\n✓ Resolved ${resolvedCount} claims | ${Object.keys(entityMap).length} entities identified`,
    );

    // STEP 3: Preprocess — embedding similarity search (uses resolved claim text)
    console.log("\n🧠 Step 3/5: Preprocessing claims (similarity search)...");
    const plan = await preprocessClaims(resolvedClaims, entityMap);

    console.log(
      `\n✓ Plan: ${plan.stats.cacheHits} cache hits | ` +
      `${plan.stats.relatedMatches} related | ` +
      `${plan.stats.newClaims} new | ` +
      `${plan.stats.groupsFormed} groups | ` +
      `~${plan.stats.estimatedTokenSavings.toLocaleString()} tokens saved`,
    );

    // STEP 4: Verify only claims that need it
    console.log("\n🔍 Step 4/5: Verifying claims...");
    const newResults: VerificationResult[] = [];

    for (let i = 0; i < plan.claimsToVerify.length; i++) {
      const item = plan.claimsToVerify[i];
      console.log(`\n[${i + 1}/${plan.claimsToVerify.length}] Verifying...`);

      try {
        const verification = await verifyClaimWithCache(item.claim, tracker, i + 1);
        newResults.push(verification);

        // Post-verification: save the embedding vector so the store grows over time
        if (item.vector && !verification.from_cache) {
          try {
            saveClaimVector(
              item.claim.claim,
              item.vector,
              verification.verdict,
              verification.confidence,
              verification.explanation,
              verification.evidence,
            );
          } catch (err) {
            // Non-fatal: duplicate or other constraint violation
            console.warn("  ⚠️  Vector store insert skipped:", (err as Error).message);
          }
        }
      } catch (error) {
        console.error(`❌ Failed to verify claim ${item.claim.id}:`, error);
      }
    }

    // Combine cached results with freshly verified results
    const cachedResults: VerificationResult[] = plan.cachedClaims.map((c) => ({
      claim_id: c.claim.id,
      claim: c.claim.claim,
      verdict: c.cachedResult.verdict,
      confidence: c.cachedResult.confidence,
      explanation: c.cachedResult.explanation + " [From vector cache]",
      evidence: c.cachedResult.evidence,
      search_queries_used: [],
      verification_timestamp: new Date().toISOString(),
      from_cache: true,
    }));

    const verificationResults = [...cachedResults, ...newResults];

    // STEP 5: Generate report
    console.log("\n📊 Step 5/5: Generating report...");
    const report = await generateReport(extractionResult, verificationResults, tracker);

    const tokenSummary = tracker.getSummary();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("\n" + "=".repeat(80));
    console.log(`✅ FACT-CHECK COMPLETE in ${duration}s`);
    console.log(`   Tokens: ${tokenSummary.totalTokens.toLocaleString()} | Cost: $${tokenSummary.totalCost.toFixed(4)}`);
    console.log("=".repeat(80));

    return { ...report, token_usage: tokenSummary };
  } catch (error) {
    console.error("\n❌ FACT-CHECK FAILED:", error);
    throw error;
  }
}

/**
 * Display report in a readable format
 */
export function displayReport(report: FactCheckReport): void {
  console.log("\n" + "═".repeat(80));
  console.log("📄 FACT-CHECK REPORT");
  console.log("═".repeat(80));

  console.log("\n📊 OVERVIEW");
  console.log("-".repeat(80));
  console.log(`Total Claims: ${report.total_claims}`);
  console.log(`  • Verifiable: ${report.verifiable_claims}`);
  console.log(`  • Opinions: ${report.opinion_claims}`);
  console.log(`  • Ambiguous: ${report.ambiguous_claims}`);

  console.log("\n📝 EXECUTIVE SUMMARY");
  console.log("-".repeat(80));
  console.log(report.summary);

  console.log("\n🔍 DETAILED VERIFICATION RESULTS");
  console.log("-".repeat(80));

  report.verification_results.forEach((result, idx) => {
    const verdictEmoji = {
      TRUE: "✅",
      FALSE: "❌",
      PARTIALLY_TRUE: "⚠️",
      UNVERIFIABLE: "❓",
      NEEDS_CONTEXT: "📎",
    }[result.verdict];

    console.log(
      `\n${idx + 1}. ${verdictEmoji} ${result.verdict} (${result.confidence} confidence)`,
    );
    console.log(`   Claim: "${result.claim}"`);
    console.log(`   ${result.explanation}`);

    if (result.evidence.length > 0) {
      console.log(`   Evidence:`);
      result.evidence.forEach((ev, i) => {
        console.log(`     ${i + 1}. ${ev.snippet.substring(0, 80)}...`);
        if (ev.url) {
          console.log(`        Source: ${ev.url}`);
        }
      });
    }
  });

  console.log("\n" + "═".repeat(80));
  console.log(`Generated: ${new Date(report.generated_at).toLocaleString()}`);
  console.log("═".repeat(80) + "\n");
}

/**
 * Save report to JSON file
 */
export function saveReport(
  report: FactCheckReport,
  filename: string = "fact-check-report.json",
): void {
  const outputDir = path.join(process.cwd(), "reports");

  try {
    // Check if 'reports' exists and is a file (not a directory)
    if (fs.existsSync(outputDir)) {
      const stats = fs.statSync(outputDir);
      if (stats.isFile()) {
        console.log(`⚠️  'reports' exists as a file, removing it...`);
        fs.unlinkSync(outputDir);
      }
    }

    // Create reports directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filepath = path.join(outputDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));

    console.log(`\n💾 Report saved to: ${filepath}`);
  } catch (error) {
    console.error("❌ Failed to save report:", error);
    // Fallback: save in current directory
    const fallbackPath = path.join(process.cwd(), filename);
    fs.writeFileSync(fallbackPath, JSON.stringify(report, null, 2));
    console.log(`💾 Report saved to fallback location: ${fallbackPath}`);
  }
}

/**
 * Example usage
 */
async function main() {
  // Sample article for testing
  const sampleArticle = `
Breaking News: Tech Innovation Transforms Industry

San Francisco, March 15, 2024 - A revolutionary new AI system was unveiled today by TechCorp, 
claiming to achieve human-level performance on complex reasoning tasks. The company's CEO, 
Sarah Johnson, stated that "this is the most significant breakthrough in AI history."

The system, named "ThinkAI", reportedly scored 95% on standardized intelligence tests, 
surpassing previous records. Industry experts believe this will transform healthcare, 
education, and scientific research within the next year.

However, some researchers remain skeptical. Dr. Michael Chen from MIT commented that 
"extraordinary claims require extraordinary evidence." The company has not yet published 
peer-reviewed research to support their claims.

TechCorp's stock price surged 40% following the announcement, reaching an all-time high 
of $500 per share. The company was founded in 2020 and is based in San Francisco.
  `.trim();

  try {
    // Run fact-check
    const report = await factCheckArticle(sampleArticle);

    // Display results
    displayReport(report);

    // Save to file
    saveReport(report);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

// Only run main() when this file is executed directly (not when imported)
// This allows `npm run fact-check` to work while preventing auto-execution during API startup
import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
