/**
 * Shared types for the fact-checker system
 */

// Claim categories
export type ClaimCategory = "VERIFIABLE" | "OPINION" | "AMBIGUOUS";

// Verification verdict
export type VerificationVerdict =
  | "TRUE"
  | "FALSE"
  | "PARTIALLY_TRUE"
  | "UNVERIFIABLE"
  | "NEEDS_CONTEXT";

// Confidence level
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

// A single claim extracted from an article
export interface Claim {
  id: string;
  claim: string;
  category: ClaimCategory;
  reason: string;
  source_reference?: string;
}

// Result of claim extraction
export interface ClaimExtractionResult {
  article_text: string;
  claims: Claim[];
  total_count: number;
  extraction_timestamp: string;
}

// Evidence source
export interface EvidenceSource {
  url?: string;
  title?: string;
  snippet: string;
  relevance: "HIGH" | "MEDIUM" | "LOW";
}

// Verification result for a single claim
export interface VerificationResult {
  claim_id: string;
  claim: string;
  verdict: VerificationVerdict;
  confidence: ConfidenceLevel;
  explanation: string;
  evidence: EvidenceSource[];
  search_queries_used: string[];
  verification_timestamp: string;
  from_cache?: boolean;
}

// Final fact-check report
export interface FactCheckReport {
  article_source?: string;
  article_preview: string;
  total_claims: number;
  verifiable_claims: number;
  opinion_claims: number;
  ambiguous_claims: number;
  verification_results: VerificationResult[];
  summary: string;
  generated_at: string;
  token_usage?: TokenUsageSummary;
}

// Article content (fetched from URL)
export interface ArticleContent {
  url: string;
  title?: string;
  content: string;
  fetch_timestamp: string;
}

// Token usage for a single processing step
export type AgentType = 'claim_extractor' | 'verifier' | 'report_generator';

export interface TokenStepUsage {
  step: string;
  stepNumber: number;
  agentType: AgentType;
  model: string;
  tokens: { input: number; output: number; total: number };
  cost: number;
  durationMs: number;
  cacheHit?: boolean;
  cumulative: {
    tokens: number;
    cost: number;
    durationMs: number;
  };
}

// Aggregated token usage summary for a full fact-check job
export interface TokenUsageSummary {
  totalTokens: number;
  totalCost: number;
  totalDurationMs: number;
  totalSteps: number;
  steps: TokenStepUsage[];
}
