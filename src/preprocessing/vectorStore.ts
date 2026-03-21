import { eq, gt, lt, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { claimVectors } from '../db/schema.js';
import type { StoredClaimVector } from './types.js';
import type { EvidenceSource } from '../types.js';

function normalizeClaim(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Load all non-expired claim vectors from the database.
 * Parses JSON embedding strings back to number arrays.
 */
export function getAllVectors(): StoredClaimVector[] {
  const now = new Date().toISOString();
  const rows = db
    .select()
    .from(claimVectors)
    .where(gt(claimVectors.expiresAt, now))
    .all();

  return rows.map((row) => ({
    ...row,
    embedding: JSON.parse(row.embedding) as number[],
    verificationCount: row.verificationCount ?? 0,
  }));
}

/**
 * Save a newly verified claim with its embedding vector.
 * Called AFTER verification completes (post-verification step).
 *
 * @returns The new row's id
 */
export function saveClaimVector(
  claimText: string,
  embedding: number[],
  verdict: string,
  confidence: string,
  explanation: string,
  evidence: EvidenceSource[],
  ttlDays: number = 30,
): string {
  const id = uuidv4();
  const now = new Date();
  const expires = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

  db.insert(claimVectors)
    .values({
      id,
      claimText,
      claimTextNormalized: normalizeClaim(claimText),
      embedding: JSON.stringify(embedding),
      verdict,
      confidence,
      explanation,
      evidence: JSON.stringify(evidence),
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      verificationCount: 0,
    })
    .run();

  return id;
}

/**
 * Increment the verification count when a cache hit is used.
 */
export function incrementHitCount(id: string): void {
  db.update(claimVectors)
    .set({
      verificationCount: sql`${claimVectors.verificationCount} + 1`,
    })
    .where(eq(claimVectors.id, id))
    .run();
}

/**
 * Delete expired claim vectors.
 * Returns the number of rows deleted.
 */
export function deleteExpired(): number {
  const now = new Date().toISOString();
  const result = db
    .delete(claimVectors)
    .where(lt(claimVectors.expiresAt, now))
    .run();
  return result.changes;
}
