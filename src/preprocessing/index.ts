import type { Claim, ResolvedClaim, EntityMap } from '../types.js';
import { generateEmbeddings } from './embedder.js';
import { getAllVectors, incrementHitCount } from './vectorStore.js';
import { findBestMatch, findIntraArticlePairs } from './similarity.js';
import { groupRelatedClaims } from './claimGrouper.js';
import {
  type ClaimWithVector,
  type VerificationPlan,
  DEFAULT_SIMILARITY_CONFIG,
  type SimilarityConfig,
} from './types.js';

/**
 * Main preprocessing function.
 * Accepts resolved claims (from the Reference Resolver) and an entity map.
 * Uses the resolved claim text for embeddings to improve cache hit rates.
 *
 * Steps:
 *   1. Filter to VERIFIABLE claims only
 *   2. Batch embed all verifiable claims (using resolved text)
 *   3. Compare each against the vector store (cache hit / related / new)
 *   4. Group related claims within the article (embedding + entity signals)
 *   5. Annotate claims-to-verify with group info
 *   6. Return the plan (vectors attached for post-verification storage)
 */
export async function preprocessClaims(
  resolvedClaims: ResolvedClaim[],
  entityMap: EntityMap = {},
  config: SimilarityConfig = DEFAULT_SIMILARITY_CONFIG,
): Promise<VerificationPlan> {
  const verifiable = resolvedClaims.filter((c) => c.category === 'VERIFIABLE');

  if (verifiable.length === 0) {
    return emptyPlan(resolvedClaims.length);
  }

  // Map ResolvedClaim → Claim using resolvedClaim text so the verifier and cache
  // use the resolved (entity-expanded) text throughout.
  const claimsForPlan: Claim[] = verifiable.map((rc) => ({
    id: rc.id,
    claim: rc.resolvedClaim,
    category: rc.category,
    reason: '',
    source_reference: rc.originalClaim !== rc.resolvedClaim ? rc.originalClaim : undefined,
  }));

  // Step 1: Batch embed all verifiable claims (resolved text)
  const texts = claimsForPlan.map((c) => c.claim);
  const vectors = await generateEmbeddings(texts);

  const claimsWithVectors: ClaimWithVector[] = claimsForPlan.map((claim, i) => ({
    claim,
    vector: vectors[i],
  }));

  // Step 2: Load cached vectors from DB, compare each new claim
  const cachedVectors = getAllVectors();

  const cachedClaims: VerificationPlan['cachedClaims'] = [];
  const claimsToVerify: VerificationPlan['claimsToVerify'] = [];

  for (const cwv of claimsWithVectors) {
    const match = findBestMatch(cwv.vector, cachedVectors, config);

    if (match && match.tier === 'EXACT_MATCH') {
      // Tier 1: cache hit — skip verification entirely
      cachedClaims.push({
        claim: cwv.claim,
        cachedResult: match.cachedVerdict!,
        similarityScore: match.score,
        cachedClaimText: match.cachedClaimText,
      });
      incrementHitCount(match.cachedClaimId);

    } else if (match && match.tier === 'RELATED') {
      // Tier 2: related match — verify but seed the prompt with cached evidence
      claimsToVerify.push({
        claim: cwv.claim,
        vector: cwv.vector,
        relatedEvidence: {
          cachedClaimText: match.cachedClaimText,
          cachedVerdict: match.cachedVerdict!,
          similarityScore: match.score,
        },
      });

    } else {
      // Tier 3: no match — full verification from scratch
      claimsToVerify.push({
        claim: cwv.claim,
        vector: cwv.vector,
      });
    }
  }

  // Step 3: Intra-article grouping (only for claims that need verification)
  const verifyVectors = claimsWithVectors.filter((cwv) =>
    claimsToVerify.some((ctv) => ctv.claim.id === cwv.claim.id),
  );

  const pairs = findIntraArticlePairs(verifyVectors, config.intraArticleGroupThreshold);
  const claimGroups = groupRelatedClaims(verifyVectors, pairs, entityMap);

  // Step 4: Annotate claimsToVerify with group membership
  for (const group of claimGroups) {
    for (const claimId of group.claimIds) {
      const ctv = claimsToVerify.find((c) => c.claim.id === claimId);
      if (ctv) {
        ctv.groupId = group.groupId;
        ctv.isGroupPrimary = claimId === group.primaryClaimId;
      }
    }
  }

  const stats = {
    totalClaims: resolvedClaims.length,
    verifiableClaims: verifiable.length,
    cacheHits: cachedClaims.length,
    relatedMatches: claimsToVerify.filter((c) => c.relatedEvidence).length,
    newClaims: claimsToVerify.filter((c) => !c.relatedEvidence).length,
    groupsFormed: claimGroups.length,
    // Rough estimate: each skipped claim saves ~2000 input + 600 output tokens
    estimatedTokenSavings: cachedClaims.length * 2600,
  };

  console.log(
    `[Preprocessor] ${stats.cacheHits} cache hits, ` +
    `${stats.relatedMatches} related, ${stats.newClaims} new, ` +
    `${stats.groupsFormed} groups formed`,
  );

  return { cachedClaims, claimsToVerify, claimGroups, stats };
}

function emptyPlan(totalClaims: number): VerificationPlan {
  return {
    cachedClaims: [],
    claimsToVerify: [],
    claimGroups: [],
    stats: {
      totalClaims,
      verifiableClaims: 0,
      cacheHits: 0,
      relatedMatches: 0,
      newClaims: 0,
      groupsFormed: 0,
      estimatedTokenSavings: 0,
    },
  };
}

// Re-export public types
export type { VerificationPlan, ClaimGroup, SimilarityConfig } from './types.js';
export { saveClaimVector } from './vectorStore.js';
