import type { ClaimWithVector, SimilarityMatch, StoredClaimVector } from './types.js';
import { SimilarityConfig, DEFAULT_SIMILARITY_CONFIG } from './types.js';

/**
 * Compute cosine similarity between two normalized vectors.
 * Since vectors from all-MiniLM-L6-v2 are L2-normalized, cosine similarity = dot product.
 *
 * @returns Score between -1 and 1 (higher = more similar)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }
  return dotProduct;
}

/**
 * Classify a similarity score into a matching tier.
 */
export function classifyMatch(
  score: number,
  config: SimilarityConfig = DEFAULT_SIMILARITY_CONFIG,
): 'EXACT_MATCH' | 'RELATED' | 'NO_MATCH' {
  if (score >= config.exactMatchThreshold) return 'EXACT_MATCH';
  if (score >= config.relatedThreshold) return 'RELATED';
  return 'NO_MATCH';
}

/**
 * Find the best matching cached claim for a given query vector.
 * Brute-force comparison against all stored vectors.
 *
 * @returns Best match if score >= relatedThreshold, otherwise null
 */
export function findBestMatch(
  queryVector: number[],
  cachedVectors: StoredClaimVector[],
  config: SimilarityConfig = DEFAULT_SIMILARITY_CONFIG,
): SimilarityMatch | null {
  if (cachedVectors.length === 0) return null;

  let bestScore = -Infinity;
  let bestMatch: StoredClaimVector | null = null;

  for (const cached of cachedVectors) {
    const score = cosineSimilarity(queryVector, cached.embedding);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = cached;
    }
  }

  if (!bestMatch || bestScore < config.relatedThreshold) {
    return null;
  }

  return {
    cachedClaimId: bestMatch.id,
    cachedClaimText: bestMatch.claimText,
    score: bestScore,
    tier: classifyMatch(bestScore, config),
    cachedVerdict: {
      verdict: bestMatch.verdict as CachedVerdict['verdict'],
      confidence: bestMatch.confidence as CachedVerdict['confidence'],
      explanation: bestMatch.explanation,
      evidence: JSON.parse(bestMatch.evidence),
      verifiedAt: bestMatch.createdAt,
    },
  };
}

type CachedVerdict = import('./types.js').CachedVerdict;

/**
 * Compare all claims against each other (intra-article grouping).
 * Returns pairs of claim IDs that are similar enough to group together.
 *
 * @returns Array of [claimIdA, claimIdB, score] tuples
 */
export function findIntraArticlePairs(
  claimsWithVectors: ClaimWithVector[],
  threshold: number = DEFAULT_SIMILARITY_CONFIG.intraArticleGroupThreshold,
): Array<[string, string, number]> {
  const pairs: Array<[string, string, number]> = [];

  for (let i = 0; i < claimsWithVectors.length; i++) {
    for (let j = i + 1; j < claimsWithVectors.length; j++) {
      const score = cosineSimilarity(
        claimsWithVectors[i].vector,
        claimsWithVectors[j].vector,
      );
      if (score >= threshold) {
        pairs.push([
          claimsWithVectors[i].claim.id,
          claimsWithVectors[j].claim.id,
          score,
        ]);
      }
    }
  }

  return pairs;
}
