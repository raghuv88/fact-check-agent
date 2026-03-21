# Fact-Check Agent

A multi-agent AI system that verifies factual claims in articles and text using Claude and web search.

## How It Works

1. **Extract** — Claude analyzes input text and extracts atomic, verifiable claims
2. **Resolve References** — Pronouns, aliases, and descriptive references (e.g. "the company's CEO") are resolved to their canonical entities so downstream steps work with unambiguous claim text
3. **Preprocess** — Each resolved claim is embedded locally using `all-MiniLM-L6-v2`. Embeddings are compared against a vector store of previously verified claims. Cache hits skip verification entirely; related matches seed the verifier prompt with prior evidence; new claims go through full verification. Related claims within the same article are grouped to avoid redundant searches.
4. **Verify** — Only new (uncached) claims are sent to the verifier agent, which researches each via web search and assigns a verdict
5. **Report** — A comprehensive report is generated with verdicts, confidence levels, and sources, combining cached and freshly verified results

## Verdict Types

| Verdict | Meaning |
|---------|---------|
| `TRUE` | Claim is supported by evidence |
| `FALSE` | Claim is contradicted by evidence |
| `PARTIALLY_TRUE` | Claim is partially correct |
| `UNVERIFIABLE` | Insufficient evidence found |
| `NEEDS_CONTEXT` | Claim requires additional context |

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **AI**: Anthropic Claude (`claude-haiku-4-5-20251001`)
- **Embeddings**: `@xenova/transformers` — `all-MiniLM-L6-v2` (local, 384 dimensions, ~80 MB, runs fully offline after first download)
- **Web Search**: Serper API (Google Search)
- **API**: Express.js 5
- **Database**: SQLite via Drizzle ORM (usage tracking + vector store)

## Getting Started

### Prerequisites

- Node.js 18+
- [Anthropic API key](https://console.anthropic.com/)
- [Serper API key](https://serper.dev/)

### Setup

```bash
npm install
cp .env.example .env  # Add your API keys
```

`.env` file:
```
ANTHROPIC_API_KEY=your_key_here
SERPER_API_KEY=your_key_here
PORT=3000
```

### CLI Usage

```bash
# Fact-check a URL
npm run fact-check -- --url https://example.com/article

# Fact-check raw text
npm run fact-check -- --text "The Earth is 4.5 billion years old."
```

### API Server

```bash
npm run dev    # Development with hot reload
npm start      # Production
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/factcheck/text` | Fact-check raw text (waits for full result) |
| `POST` | `/api/v1/factcheck/stream` | Fact-check with real-time SSE streaming |
| `POST` | `/api/v1/factcheck/url` | Fact-check article at URL |
| `POST` | `/api/v1/factcheck/claims` | Extract claims only (no verification) |
| `GET` | `/api/v1/reports` | List saved reports |
| `GET` | `/api/v1/reports/:id` | Get a specific report |
| `DELETE` | `/api/v1/reports/:id` | Delete a report |

### POST /api/v1/factcheck/text

Synchronous endpoint — waits for the entire fact-check to complete before returning. May time out for long articles.

```bash
curl -X POST http://localhost:3000/api/v1/factcheck/text \
  -H "Content-Type: application/json" \
  -d '{"text": "The Great Wall of China is visible from space."}'
```

### POST /api/v1/factcheck/stream

Streaming endpoint using **Server-Sent Events (SSE)**. Returns a stream of JSON events as each claim is extracted and verified in real-time — no timeout issues for long articles.

**Request body:** `{ "text": string }`

**Response:** `Content-Type: text/event-stream`

Each line is a `data: <json>\n\n` SSE event. Event types:

| Event type | When | Payload |
|------------|------|---------|
| `status` | Processing milestones | `{ type, message }` |
| `claims_extracted` | After claim extraction | `{ type, verifiable_claims, opinion_claims, total }` |
| `references_resolved` | After reference resolution | `{ type, data: { resolvedCount, entitiesFound, resolutions } }` |
| `claim_verifying` | Before each claim is verified | `{ type, claim_id, claim, index, total }` |
| `claim_verified` | After each claim is verified | `{ type, result, index, total, from_cache }` |
| `token_usage` | After each agent step completes | `{ type, data: TokenStepUsage }` |
| `complete` | All done | `{ type, report, job_id, token_usage }` |
| `error` | On failure | `{ type, message }` |

`from_cache: true` on a `claim_verified` event means the result was served from cache (hash match or vector similarity) — no LLM call was made and 0 tokens were consumed for that claim.

The `references_resolved` payload includes the resolved count, entity count, and an array of individual resolutions applied:

```json
{
  "type": "references_resolved",
  "data": {
    "resolvedCount": 4,
    "entitiesFound": 5,
    "resolutions": [
      { "original": "the tech giant", "resolvedTo": "Alphabet/Google", "confidence": "HIGH" },
      { "original": "Pichai", "resolvedTo": "Sundar Pichai", "confidence": "HIGH" },
      { "original": "the new AI model", "resolvedTo": "Google's Gemini 2.0", "confidence": "HIGH" }
    ]
  }
}
```

**Example — consume stream with curl:**

```bash
curl -X POST http://localhost:3000/api/v1/factcheck/stream \
  -H "Content-Type: application/json" \
  -d '{"text": "The Great Wall of China is visible from space."}' \
  --no-buffer
```

**Example — consume stream in JavaScript:**

```js
const response = await fetch('http://localhost:3000/api/v1/factcheck/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: articleText }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const parts = buffer.split('\n\n');
  buffer = parts.pop() ?? '';

  for (const part of parts) {
    const json = part.replace(/^data:\s*/, '').trim();
    if (json) {
      const event = JSON.parse(json);
      console.log(event.type, event);
    }
  }
}
```

### Token Usage Tracking

Every fact-check response (streaming and synchronous) includes a `token_usage` summary showing how many tokens were consumed and the estimated cost per step.

**`token_usage` summary shape** (present in `complete` event and saved reports):

```json
{
  "totalTokens": 14250,
  "totalCost": 0.0341,
  "totalDurationMs": 14900,
  "totalSteps": 6,
  "steps": [
    {
      "step": "Extract Claims",
      "stepNumber": 1,
      "agentType": "claim_extractor",
      "tokens": { "input": 1234, "output": 567, "total": 1801 },
      "cost": 0.0034,
      "durationMs": 2300,
      "cacheHit": false,
      "cumulative": { "tokens": 1801, "cost": 0.0034, "durationMs": 2300 }
    },
    {
      "step": "Resolve References",
      "stepNumber": 2,
      "agentType": "reference_resolver",
      "tokens": { "input": 1100, "output": 950, "total": 2050 },
      "cost": 0.0059,
      "durationMs": 3200,
      "cacheHit": false,
      "cumulative": { "tokens": 3851, "cost": 0.0093, "durationMs": 5500 }
    },
    {
      "step": "Verify Claim 1",
      "stepNumber": 3,
      "agentType": "verifier",
      "tokens": { "input": 2100, "output": 890, "total": 2990 },
      "cost": 0.0196,
      "durationMs": 8100,
      "cacheHit": false,
      "cumulative": { "tokens": 6841, "cost": 0.0289, "durationMs": 13600 }
    },
    {
      "step": "Verify Claim 2",
      "stepNumber": 4,
      "agentType": "verifier",
      "tokens": { "input": 0, "output": 0, "total": 0 },
      "cost": 0,
      "durationMs": 0,
      "cacheHit": true,
      "cumulative": { "tokens": 6841, "cost": 0.0289, "durationMs": 13600 }
    }
  ]
}
```

Steps with `cacheHit: true` consumed 0 tokens — the result was returned instantly from the local verified-claims cache.

**Pricing used** (Anthropic claude-haiku-4-5-20251001):
- Input: $1.00 per million tokens
- Output: $5.00 per million tokens

In the stream endpoint, a `token_usage` event is emitted in real time after each agent step completes, so the UI can display a live cost/token breakdown as the fact-check progresses.

## Project Structure

```
src/
├── agents/
│   ├── index.ts             # Claim extractor, fact verifier, report generator
│   ├── referenceResolver.ts # Reference resolution agent (pronouns → canonical entities)
│   └── supervisor-agent.ts
├── preprocessing/           # Embedding-based claim preprocessing
│   ├── index.ts             # preprocessClaims(resolvedClaims, entityMap) → VerificationPlan
│   ├── embedder.ts          # Lazy-loads all-MiniLM-L6-v2, generates 384-dim vectors
│   ├── similarity.ts        # cosineSimilarity, classifyMatch, findBestMatch, intra-article pairs
│   ├── vectorStore.ts       # Save/load/search claim vectors in SQLite
│   ├── claimGrouper.ts      # Union-Find grouping (embedding + entity co-occurrence signals)
│   └── types.ts             # ClaimWithVector, SimilarityMatch, VerificationPlan, etc.
├── db/
│   ├── schema.ts            # Drizzle table definitions
│   ├── index.ts             # DB connection + migration runner
│   ├── repository.ts        # CRUD helpers (createRequest, markComplete, etc.)
│   └── migrations/          # SQL migration files (auto-applied on startup)
├── tools/                   # Web search and article fetching tools
├── routes/                  # API endpoint handlers
├── middleware/
│   ├── tokenTracker.ts      # Token usage tracking (wraps all Claude API calls)
│   ├── errorHandler.ts      # Error handling
│   └── logger.ts            # Request logging
├── fact-checker.ts          # Main orchestration logic (5-step pipeline)
├── server.ts                # Express server entry point
└── types.ts                 # TypeScript interfaces
data/
└── usage.db                 # SQLite database (gitignored)
reports/                     # Saved JSON reports (gitignored)
```

## Caching

The system has two caching layers that together avoid redundant LLM verification calls:

### Layer 1 — Exact Hash Cache

Identical claim strings (same wording) are matched by SHA-256 hash before the verifier runs.

1. The claim text is normalised (lowercased + trimmed) and hashed.
2. If a match exists in `verified_claims_cache`, the stored verdict is returned instantly (`from_cache: true`, 0 tokens consumed).
3. On a miss, the verifier runs and writes the result to the cache.
4. Each hit increments `verification_count` and accumulates `token_savings`.

### Layer 2 — Vector Similarity Cache

Semantically similar claims (different wording, same meaning) are matched using local embeddings — no LLM needed for the comparison itself.

1. During the preprocessing step, every verifiable claim is embedded with `all-MiniLM-L6-v2` (384-dim vector, runs locally).
2. Each embedding is compared against all stored vectors using cosine similarity.
3. Matches are classified into three tiers:

| Tier | Score | Action |
|------|-------|--------|
| **Exact match** | ≥ 0.92 | Skip verification — return cached verdict |
| **Related** | 0.75 – 0.92 | Verify, but seed verifier prompt with cached evidence (fewer searches needed) |
| **No match** | < 0.75 | Full verification from scratch |

4. After a new claim is verified, its embedding vector is saved to `claim_vectors` — the store grows over time, improving future hit rates.

The model is downloaded once (~80 MB to `~/.cache/huggingface/`) and loaded into memory on first use. Subsequent requests within the same process reuse the loaded model with no startup cost.

Both layers are transparent — `VerificationResult` objects include a `from_cache` boolean, and the preprocessing stats (cache hits, related matches, token savings estimate) are logged and emitted as a `preprocessing_result` SSE event.

## Database

SQLite database at `data/usage.db` is created automatically on first startup. It tracks four tables:

| Table | Purpose |
|-------|---------|
| `fact_check_requests` | One row per job — status, total tokens/cost/duration |
| `token_usage` | One row per agent step — per-step token breakdown; `cache_hit` is `true` for cached verifier steps |
| `verified_claims_cache` | Layer 1 cache — exact-match lookup by SHA-256 hash; stores verdict, confidence, explanation, evidence, hit count, and token savings |
| `claim_vectors` | Layer 2 cache — 384-dim embedding vectors stored as JSON; used for semantic similarity search; TTL of 30 days per row |

### Inspect the database

```bash
# Drizzle Studio (web UI)
npm run db:studio

# SQLite CLI
sqlite3 data/usage.db
.tables
SELECT * FROM fact_check_requests;
SELECT * FROM token_usage;
.quit
```

### DB scripts

```bash
npm run db:generate   # Generate new migration from schema changes
npm run db:migrate    # Apply pending migrations
npm run db:studio     # Open Drizzle Studio web UI
```

## Scripts

```bash
npm run dev           # Start dev server with hot reload
npm start             # Start production server
npm run build         # Compile TypeScript
npm run fact-check    # Run CLI fact-checker
npm run db:generate   # Generate DB migration
npm run db:migrate    # Apply DB migrations
npm run db:studio     # Browse DB in web UI
```
