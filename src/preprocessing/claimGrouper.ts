import type { ClaimGroup, ClaimWithVector } from './types.js';
import { DEFAULT_SIMILARITY_CONFIG } from './types.js';
import { cosineSimilarity } from './similarity.js';
import type { EntityMap } from '../types.js';

/**
 * Union-Find data structure for grouping connected claims.
 * If claim A is similar to B, and B similar to C, all three join the same group.
 */
class UnionFind {
  private parent: Map<string, string>;

  constructor(ids: string[]) {
    this.parent = new Map(ids.map((id) => [id, id]));
  }

  find(x: string): string {
    if (this.parent.get(x) !== x) {
      // Path compression
      this.parent.set(x, this.find(this.parent.get(x)!));
    }
    return this.parent.get(x)!;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent.set(rootB, rootA);
    }
  }
}

/**
 * Group related claims using similarity pairs and optionally entity co-occurrence.
 *
 * Grouping signals:
 *   1. Embedding similarity > intraArticleGroupThreshold (0.70)
 *   2. Claims share 2+ entities from entityMap
 *   3. Embedding similarity in moderate zone (0.55–0.70) AND share 1+ entity
 *
 * @param claims - All claims from the article with their vectors
 * @param pairs - Similar claim pairs from findIntraArticlePairs()
 * @param entityMap - Optional entity map from the Reference Resolver
 * @returns Array of claim groups
 */
export function groupRelatedClaims(
  claims: ClaimWithVector[],
  pairs: Array<[string, string, number]>,
  entityMap?: EntityMap,
): ClaimGroup[] {
  const claimIds = claims.map((c) => c.claim.id);
  const uf = new UnionFind(claimIds);

  // Signal 1: embedding similarity (existing logic)
  for (const [idA, idB] of pairs) {
    uf.union(idA, idB);
  }

  // Signal 2: shared entities (2+ shared → group)
  if (entityMap) {
    const entityPairs = findEntityPairs(claimIds, entityMap);
    for (const [idA, idB] of entityPairs) {
      uf.union(idA, idB);
    }

    // Signal 3: moderate similarity + 1 shared entity
    const combinedPairs = findCombinedSignalPairs(claims, entityMap);
    for (const [idA, idB] of combinedPairs) {
      uf.union(idA, idB);
    }
  }

  if (claimIds.length === 0) return [];

  // Collect groups by root
  const groupMap = new Map<string, string[]>();
  for (const id of claimIds) {
    const root = uf.find(id);
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root)!.push(id);
  }

  const groups: ClaimGroup[] = [];
  let groupCounter = 0;

  for (const [, memberIds] of groupMap) {
    if (memberIds.length < 2) continue;

    groupCounter++;
    const groupId = `group_${groupCounter}`;

    // Primary claim = longest claim text (usually the most specific)
    const primaryId = memberIds.reduce((best, id) => {
      const bestClaim = claims.find((c) => c.claim.id === best)!;
      const currentClaim = claims.find((c) => c.claim.id === id)!;
      return currentClaim.claim.claim.length > bestClaim.claim.claim.length
        ? id
        : best;
    });

    const primaryClaim = claims.find((c) => c.claim.id === primaryId)!;
    const theme =
      primaryClaim.claim.claim.length > 60
        ? primaryClaim.claim.claim.substring(0, 60) + '...'
        : primaryClaim.claim.claim;

    groups.push({ groupId, theme, claimIds: memberIds, primaryClaimId: primaryId });
  }

  return groups;
}

/**
 * Find claim pairs that share 2+ entities — strong grouping signal.
 */
function findEntityPairs(
  claimIds: string[],
  entityMap: EntityMap,
): Array<[string, string]> {
  const claimEntities = new Map<string, Set<string>>();
  for (const id of claimIds) claimEntities.set(id, new Set());

  for (const [entityName, entityInfo] of Object.entries(entityMap)) {
    for (const claimId of entityInfo.claimIds) {
      if (claimEntities.has(claimId)) {
        claimEntities.get(claimId)!.add(entityName);
      }
    }
  }

  const pairs: Array<[string, string]> = [];
  const ids = Array.from(claimEntities.keys());

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const entitiesA = claimEntities.get(ids[i])!;
      const entitiesB = claimEntities.get(ids[j])!;
      let shared = 0;
      for (const e of entitiesA) {
        if (entitiesB.has(e)) shared++;
      }
      if (shared >= 2) pairs.push([ids[i], ids[j]]);
    }
  }

  return pairs;
}

/**
 * Find claim pairs in the moderate similarity zone (combinedSignalThreshold to
 * intraArticleGroupThreshold) that also share at least one entity.
 * This is Signal 3: moderate similarity + shared entity = group.
 */
export function findCombinedSignalPairs(
  claims: ClaimWithVector[],
  entityMap: EntityMap,
  moderateSimilarityThreshold: number = DEFAULT_SIMILARITY_CONFIG.combinedSignalThreshold,
  upperThreshold: number = DEFAULT_SIMILARITY_CONFIG.intraArticleGroupThreshold,
): Array<[string, string]> {
  const claimEntitySets = new Map<string, Set<string>>();
  for (const claim of claims) claimEntitySets.set(claim.claim.id, new Set());

  for (const [entityName, entityInfo] of Object.entries(entityMap)) {
    for (const claimId of entityInfo.claimIds) {
      if (claimEntitySets.has(claimId)) {
        claimEntitySets.get(claimId)!.add(entityName);
      }
    }
  }

  const pairs: Array<[string, string]> = [];

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const similarity = cosineSimilarity(claims[i].vector, claims[j].vector);
      if (similarity < moderateSimilarityThreshold) continue;
      if (similarity >= upperThreshold) continue; // already handled by embedding pairs

      const entitiesA = claimEntitySets.get(claims[i].claim.id)!;
      const entitiesB = claimEntitySets.get(claims[j].claim.id)!;
      let hasShared = false;
      for (const e of entitiesA) {
        if (entitiesB.has(e)) { hasShared = true; break; }
      }
      if (hasShared) pairs.push([claims[i].claim.id, claims[j].claim.id]);
    }
  }

  return pairs;
}
