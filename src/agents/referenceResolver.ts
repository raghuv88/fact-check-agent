import Anthropic from '@anthropic-ai/sdk';
import type { Claim, ResolvedClaim, EntityMap } from '../types.js';
import { TokenTracker } from '../middleware/tokenTracker.js';

const MODEL = 'claude-haiku-4-5-20251001';

const RESOLVER_SYSTEM_PROMPT = `You are a Reference Resolution specialist. Your job is to analyze \
an article and a list of extracted claims, then:

1. IDENTIFY all named entities in the article (people, organizations, locations, products, events)
2. IDENTIFY all references/aliases for each entity (pronouns, shortened names, descriptions like \
"the company", "the tech giant", "he", "the new model", etc.)
3. RESOLVE each claim so it is completely self-contained — a reader should understand the claim \
WITHOUT reading the article.

RULES:
- Replace ALL pronouns (he, she, they, it, its) with the actual entity name
- Replace ALL descriptive references ("the company", "the tech giant", "the new model") with \
  the actual entity name
- Replace shortened names ("Pichai") with full names ("Sundar Pichai") on first use in a claim
- Keep the claim's meaning EXACTLY the same — only replace references, don't add or remove facts
- If a reference is ambiguous (could refer to multiple entities), mark confidence as LOW
- Preserve numbers, dates, and specific details exactly as they appear
- Only resolve references that appear in the article — do not hallucinate entities

RESPOND WITH ONLY valid JSON in this exact format (no markdown, no backticks, no preamble):

{
  "resolved_claims": [
    {
      "id": "claim_1",
      "original_claim": "exact original text",
      "resolved_claim": "text with all references resolved",
      "category": "VERIFIABLE",
      "entity_ids": ["Sundar Pichai", "Alphabet"],
      "resolutions_applied": [
        {
          "original": "the tech giant",
          "resolved_to": "Alphabet/Google",
          "confidence": "HIGH"
        }
      ]
    }
  ],
  "entity_map": {
    "Sundar Pichai": {
      "canonical_name": "Sundar Pichai",
      "type": "PERSON",
      "aliases": ["Pichai", "Google's CEO", "he"],
      "claim_ids": ["claim_1", "claim_5"],
      "description": "CEO of Alphabet and Google"
    }
  }
}`;

export interface ResolverInput {
  articleText: string;
  claims: Claim[];
}

export interface ResolverOutput {
  resolvedClaims: ResolvedClaim[];
  entityMap: EntityMap;
}

function buildUserMessage(articleText: string, claims: Claim[]): string {
  const claimsFormatted = claims
    .map((c) => `- ID: ${c.id} | Category: ${c.category} | Claim: "${c.claim}"`)
    .join('\n');

  return `ARTICLE:
"""
${articleText}
"""

EXTRACTED CLAIMS:
${claimsFormatted}

Resolve all references in these claims. Make each claim self-contained.
Return ONLY valid JSON as specified.`;
}

function parseResolverResponse(responseText: string): ResolverOutput {
  let cleaned = responseText.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);

  // Extract the JSON object if there's surrounding prose
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  const data = JSON.parse(cleaned);

  const resolvedClaims: ResolvedClaim[] = (data.resolved_claims ?? []).map((rc: any) => ({
    id: rc.id,
    originalClaim: rc.original_claim,
    resolvedClaim: rc.resolved_claim,
    category: rc.category,
    entityIds: rc.entity_ids ?? [],
    resolutionsApplied: (rc.resolutions_applied ?? []).map((r: any) => ({
      original: r.original,
      resolvedTo: r.resolved_to,
      confidence: r.confidence,
    })),
  }));

  const entityMap: EntityMap = {};
  for (const [key, value] of Object.entries(data.entity_map ?? {})) {
    const v = value as any;
    entityMap[key] = {
      canonicalName: v.canonical_name,
      type: v.type,
      aliases: v.aliases ?? [],
      claimIds: v.claim_ids ?? [],
      description: v.description,
    };
  }

  return { resolvedClaims, entityMap };
}

function buildFallback(claims: Claim[]): ResolverOutput {
  const resolvedClaims: ResolvedClaim[] = claims.map((c) => ({
    id: c.id,
    originalClaim: c.claim,
    resolvedClaim: c.claim,
    category: c.category,
    entityIds: [],
    resolutionsApplied: [],
  }));
  return { resolvedClaims, entityMap: {} };
}

/**
 * Reference Resolver Agent.
 *
 * Takes the original article + extracted claims and resolves all implicit
 * references so each claim becomes self-contained. Single Claude API call,
 * no tools needed. Falls back to unresolved claims on any error.
 */
export async function resolveReferences(
  input: ResolverInput,
  tracker?: TokenTracker,
): Promise<ResolverOutput> {
  console.log('\n🔗 REFERENCE RESOLVER');
  console.log('='.repeat(60));

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const stepStart = Date.now();

  try {
    const userMessage = buildUserMessage(input.articleText, input.claims);

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: RESOLVER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    if (tracker) {
      tracker.record({
        step: 'Resolve References',
        agentType: 'reference_resolver',
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: MODEL,
        durationMs: Date.now() - stepStart,
      });
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Reference resolver returned no text response');
    }

    const result = parseResolverResponse(textBlock.text);

    const resolvedCount = result.resolvedClaims.filter(
      (c) => c.resolutionsApplied.length > 0,
    ).length;
    console.log(
      `✅ Resolved ${resolvedCount}/${result.resolvedClaims.length} claims | ` +
      `${Object.keys(result.entityMap).length} entities identified`,
    );

    return result;
  } catch (error) {
    console.error('[Resolver] Failed, falling back to raw claims:', error);
    return buildFallback(input.claims);
  }
}
