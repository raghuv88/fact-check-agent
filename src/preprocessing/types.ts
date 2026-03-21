import type { Claim, EvidenceSource } from '../types.js';

// Re-export for convenience within this module
export type { Claim };

/**
 * A claim with its embedding vector attached.
 * Created during the batch embedding step.
 */
export interface ClaimWithVector {
  claim: Claim;
  /** 384-dimension float array from all-MiniLM-L6-v2 */
  vector: number[];
}

/**
 * Result of comparing a new claim against the vector store.
 */
export interface SimilarityMatch {
  cachedClaimId: string;
  cachedClaimText: string;
  /** Cosine similarity score (0 to 1) */
  score: number;
  tier: 'EXACT_MATCH' | 'RELATED' | 'NO_MATCH';
  /** Available for EXACT_MATCH and RELATED tiers */
  cachedVerdict?: CachedVerdict;
}

/**
 * Previously verified claim stored in the vector store.
 */
export interface CachedVerdict {
  verdict: 'TRUE' | 'FALSE' | 'PARTIALLY_TRUE' | 'UNVERIFIABLE' | 'NEEDS_CONTEXT';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  explanation: string;
  evidence: EvidenceSource[];
  verifiedAt: string;
}

/**
 * A group of related claims within the same article.
 */
export interface ClaimGroup {
  groupId: string;
  theme: string;
  claimIds: string[];
  primaryClaimId: string;
}

/**
 * Similarity threshold configuration.
 */
export interface SimilarityConfig {
  /** Above this = cache hit, skip verification (default: 0.92) */
  exactMatchThreshold: number;
  /** Above this = related, pass cached evidence as context (default: 0.75) */
  relatedThreshold: number;
  /** Minimum score to group intra-article claims (default: 0.70) */
  intraArticleGroupThreshold: number;
  /** Moderate similarity threshold for entity-combined signal grouping (default: 0.55) */
  combinedSignalThreshold: number;
}

export const DEFAULT_SIMILARITY_CONFIG: SimilarityConfig = {
  exactMatchThreshold: 0.92,
  relatedThreshold: 0.75,
  intraArticleGroupThreshold: 0.70,
  combinedSignalThreshold: 0.55,
};

/**
 * The main output of the preprocessing step.
 * Consumed by the Fact Verifier.
 */
export interface VerificationPlan {
  cachedClaims: {
    claim: Claim;
    cachedResult: CachedVerdict;
    similarityScore: number;
    cachedClaimText: string;
  }[];

  claimsToVerify: {
    claim: Claim;
    relatedEvidence?: {
      cachedClaimText: string;
      cachedVerdict: CachedVerdict;
      similarityScore: number;
    };
    groupId?: string;
    isGroupPrimary?: boolean;
    /** Embedding vector, stored here so we can persist it post-verification */
    vector?: number[];
  }[];

  claimGroups: ClaimGroup[];

  stats: {
    totalClaims: number;
    verifiableClaims: number;
    cacheHits: number;
    relatedMatches: number;
    newClaims: number;
    groupsFormed: number;
    estimatedTokenSavings: number;
  };
}

/**
 * Stored in SQLite: a cached claim with its vector.
 */
export interface StoredClaimVector {
  id: string;
  claimText: string;
  claimTextNormalized: string;
  embedding: number[];
  verdict: string;
  confidence: string;
  explanation: string;
  evidence: string;
  createdAt: string;
  expiresAt: string;
  verificationCount: number;
}
