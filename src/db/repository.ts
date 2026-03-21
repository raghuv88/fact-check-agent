import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from './index.js';
import { factCheckRequests, tokenUsage, verifiedClaimsCache } from './schema.js';
import { TokenUsageSummary, VerificationResult } from '../types.js';

/**
 * Create a new fact-check request record (status: pending)
 */
export function createRequest(id: string, articleText: string): void {
  db.insert(factCheckRequests).values({
    id,
    createdAt: new Date().toISOString(),
    articleText,
    status: 'pending',
  }).run();
}

/**
 * Mark a request as processing
 */
export function markProcessing(id: string): void {
  db.update(factCheckRequests)
    .set({ status: 'processing' })
    .where(eq(factCheckRequests.id, id))
    .run();
}

/**
 * Mark a request as complete and save aggregated totals
 */
export function markComplete(id: string, summary: TokenUsageSummary): void {
  db.update(factCheckRequests)
    .set({
      status: 'complete',
      totalTokens: summary.totalTokens,
      totalCostUsd: summary.totalCost,
      totalDurationMs: summary.totalDurationMs,
    })
    .where(eq(factCheckRequests.id, id))
    .run();
}

/**
 * Mark a request as failed
 */
export function markFailed(id: string): void {
  db.update(factCheckRequests)
    .set({ status: 'failed' })
    .where(eq(factCheckRequests.id, id))
    .run();
}

/**
 * Save all token usage steps for a completed request
 */
export function saveTokenUsageSteps(requestId: string, summary: TokenUsageSummary): void {
  for (const step of summary.steps) {
    db.insert(tokenUsage).values({
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      requestId,
      agentType: step.agentType,
      stepNumber: step.stepNumber,
      stepName: step.step,
      model: 'claude-sonnet-4-20250514',
      inputTokens: step.tokens.input,
      outputTokens: step.tokens.output,
      costUsd: step.cost,
      durationMs: step.durationMs,
      cacheHit: step.cacheHit ?? false,
    }).run();
  }
}

// ============================================
// VERIFIED CLAIMS CACHE
// ============================================

/**
 * Compute a stable SHA-256 hash for a claim text (normalised: lowercase + trimmed)
 */
export function hashClaim(claimText: string): string {
  return createHash('sha256')
    .update(claimText.toLowerCase().trim())
    .digest('hex');
}

/**
 * Look up a previously verified claim by its hash. Returns null on miss.
 */
export function getCachedClaim(claimHash: string) {
  return db.select()
    .from(verifiedClaimsCache)
    .where(eq(verifiedClaimsCache.claimHash, claimHash))
    .get() ?? null;
}

/**
 * Persist a newly verified claim into the cache.
 * tokensUsed is stored as the per-hit savings baseline.
 */
export function saveCachedClaim(
  claimText: string,
  result: VerificationResult,
  tokensUsed: number,
): void {
  const claimHash = hashClaim(claimText);
  db.insert(verifiedClaimsCache).values({
    id: uuidv4(),
    claimText,
    claimHash,
    verdict: result.verdict,
    confidence: result.confidence,
    explanation: result.explanation,
    evidence: JSON.stringify(result.evidence),
    verifiedAt: new Date().toISOString(),
    verificationCount: 1,
    tokenSavings: 0,
    tokensPerVerification: tokensUsed,
  }).run();
}

/**
 * Increment verification_count and accumulate token_savings on a cache hit.
 */
export function recordCacheHit(claimHash: string, tokensSaved: number): void {
  const existing = getCachedClaim(claimHash);
  if (!existing) return;
  db.update(verifiedClaimsCache)
    .set({
      verificationCount: (existing.verificationCount ?? 1) + 1,
      tokenSavings: (existing.tokenSavings ?? 0) + tokensSaved,
    })
    .where(eq(verifiedClaimsCache.claimHash, claimHash))
    .run();
}

/**
 * Get all requests with their total usage (newest first)
 */
export function getRequests() {
  return db.select().from(factCheckRequests).all();
}

/**
 * Get token usage steps for a specific request
 */
export function getTokenSteps(requestId: string) {
  return db.select().from(tokenUsage)
    .where(eq(tokenUsage.requestId, requestId))
    .all();
}
