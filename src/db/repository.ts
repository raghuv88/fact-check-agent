import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from './index.js';
import { factCheckRequests, tokenUsage } from './schema.js';
import { TokenUsageSummary } from '../types.js';

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
      cacheHit: false,
    }).run();
  }
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
