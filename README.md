# Fact-Check Agent

A multi-agent AI system that verifies factual claims in articles and text using Claude and web search.

## How It Works

1. **Extract** — Claude analyzes input text and extracts atomic, verifiable claims
2. **Verify** — Each claim is researched via web search; Claude evaluates evidence and assigns a verdict
3. **Report** — A comprehensive report is generated with verdicts, confidence levels, and sources

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
- **Web Search**: Serper API (Google Search)
- **API**: Express.js 5
- **Database**: SQLite via Drizzle ORM (usage tracking)

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
| `claim_verifying` | Before each claim is verified | `{ type, claim_id, claim, index, total }` |
| `claim_verified` | After each claim is verified | `{ type, result, index, total, from_cache }` |
| `token_usage` | After each agent step completes | `{ type, data: TokenStepUsage }` |
| `complete` | All done | `{ type, report, job_id, token_usage }` |
| `error` | On failure | `{ type, message }` |

`from_cache: true` on a `claim_verified` event means the result was served from the local cache — no LLM call was made and 0 tokens were consumed for that claim.

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
  "totalTokens": 12450,
  "totalCost": 0.0951,
  "totalDurationMs": 12700,
  "totalSteps": 5,
  "steps": [
    {
      "step": "Extract Claims",
      "stepNumber": 1,
      "agentType": "claim_extractor",
      "tokens": { "input": 1234, "output": 567, "total": 1801 },
      "cost": 0.0122,
      "durationMs": 2300,
      "cacheHit": false,
      "cumulative": { "tokens": 1801, "cost": 0.0122, "durationMs": 2300 }
    },
    {
      "step": "Verify Claim 1",
      "stepNumber": 2,
      "agentType": "verifier",
      "tokens": { "input": 2100, "output": 890, "total": 2990 },
      "cost": 0.0196,
      "durationMs": 8100,
      "cacheHit": false,
      "cumulative": { "tokens": 4791, "cost": 0.0318, "durationMs": 10400 }
    },
    {
      "step": "Verify Claim 2",
      "stepNumber": 3,
      "agentType": "verifier",
      "tokens": { "input": 0, "output": 0, "total": 0 },
      "cost": 0,
      "durationMs": 0,
      "cacheHit": true,
      "cumulative": { "tokens": 4791, "cost": 0.0318, "durationMs": 10400 }
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
├── agents/              # Claim extractor, fact verifier, report generator agents
├── db/
│   ├── schema.ts        # Drizzle table definitions
│   ├── index.ts         # DB connection + migration runner
│   ├── repository.ts    # CRUD helpers (createRequest, markComplete, etc.)
│   └── migrations/      # SQL migration files (auto-applied on startup)
├── tools/               # Web search and article fetching tools
├── routes/              # API endpoint handlers
├── middleware/
│   ├── tokenTracker.ts  # Token usage tracking (wraps all Claude API calls)
│   ├── errorHandler.ts  # Error handling
│   └── logger.ts        # Request logging
├── fact-checker.ts      # Main orchestration logic
├── server.ts            # Express server entry point
└── types.ts             # TypeScript interfaces
data/
└── usage.db             # SQLite database (gitignored)
reports/                 # Saved JSON reports (gitignored)
```

## Claim Cache

Identical claims appearing across multiple fact-check requests are served from a local SQLite cache, skipping the LLM verification step entirely. This saves tokens, reduces latency, and lowers cost.

**How it works:**

1. Before calling the verifier agent, the claim text is normalised (lowercased + trimmed) and hashed with SHA-256.
2. If a matching hash is found in `verified_claims_cache`, the stored verdict, confidence, explanation, and evidence are returned immediately (`from_cache: true`).
3. On a cache miss the full verifier agent runs, and the result is written to the cache for future reuse.
4. Each cache hit increments `verification_count` and accumulates `token_savings` on the cache row.

The cache is completely transparent — `VerificationResult` objects include a `from_cache` boolean so consumers can distinguish live verifications from cache hits.

## Database

SQLite database at `data/usage.db` is created automatically on first startup. It tracks three tables:

| Table | Purpose |
|-------|---------|
| `fact_check_requests` | One row per job — status, total tokens/cost/duration |
| `token_usage` | One row per agent step — per-step token breakdown; `cache_hit` is `true` for cached verifier steps |
| `verified_claims_cache` | Cache of previously verified claims — verdict, confidence, explanation, evidence, hit count, and token savings |

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
