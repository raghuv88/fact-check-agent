import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const factCheckRequests = sqliteTable('fact_check_requests', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
  articleText: text('article_text').notNull(),
  totalTokens: integer('total_tokens').default(0),
  totalCostUsd: real('total_cost_usd').default(0),
  totalDurationMs: integer('total_duration_ms').default(0),
  status: text('status', { enum: ['pending', 'processing', 'complete', 'failed'] })
    .notNull()
    .default('pending'),
});

export const tokenUsage = sqliteTable('token_usage', {
  id: text('id').primaryKey(),
  timestamp: text('timestamp').notNull(),
  requestId: text('request_id')
    .notNull()
    .references(() => factCheckRequests.id),
  agentType: text('agent_type', {
    enum: ['claim_extractor', 'verifier', 'report_generator'],
  }).notNull(),
  stepNumber: integer('step_number').notNull(),
  stepName: text('step_name').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  costUsd: real('cost_usd').notNull(),
  durationMs: integer('duration_ms').notNull(),
  cacheHit: integer('cache_hit', { mode: 'boolean' }).default(false),
});

export const verifiedClaimsCache = sqliteTable('verified_claims_cache', {
  id: text('id').primaryKey(),
  claimText: text('claim_text').notNull(),
  claimHash: text('claim_hash').notNull().unique(),
  verdict: text('verdict', {
    enum: ['TRUE', 'FALSE', 'PARTIALLY_TRUE', 'UNVERIFIABLE', 'NEEDS_CONTEXT'],
  }).notNull(),
  confidence: text('confidence', { enum: ['HIGH', 'MEDIUM', 'LOW'] }).notNull(),
  evidence: text('evidence').notNull(), // JSON string
  verifiedAt: text('verified_at').notNull(),
  verificationCount: integer('verification_count').default(1),
  tokenSavings: integer('token_savings').default(0),
});
