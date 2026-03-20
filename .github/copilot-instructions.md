# Fact-Check Agent - AI Coding Guidelines

## Project Overview
A TypeScript Express API that fact-checks articles using Anthropic's Claude API. It extracts claims from text, verifies them via web search, and returns structured reports.

## Architecture

### API Layer
- **Entry point**: `src/server.ts` → `src/app.ts` → `src/routes/index.ts`
- **Routes** (`src/routes/index.ts`): All route registration in one file
  - `POST /api/v1/factcheck/text` — fact-check raw text
  - `POST /api/v1/factcheck/url` — fact-check article from URL
  - `POST /api/v1/factcheck/claims` — extract claims only (no verification)
  - `POST /api/v1/factcheck/stream` — SSE streaming, sends progress events as each claim is verified
  - `GET/DELETE /api/v1/reports/:id` — manage saved reports
  - `GET /health` — health check

### Agent Layer (`src/agents/`)
- **`src/agents/index.ts`**: Three sequential agents used by all API routes:
  1. `extractClaims(text)` — extracts and categorizes claims as VERIFIABLE / OPINION / AMBIGUOUS
  2. `verifyClaim(claim)` — verifies a single claim via agentic loop with web search
  3. `generateReport(extraction, verifications)` — produces the final `FactCheckReport`
- **`src/agents/supervisor-agent.ts`**: Optional supervisor pattern — a supervisor creates a verification plan and routes claims to specialized workers (simple / thorough / expert), then reviews their results. Not used in the default API flow.

### Tools (`src/tools/index.ts`)
- `search_web`: Serper (Google Search API) — requires `SERPER_API_KEY`
- `fetch_article`: Basic HTTP fetch + HTML stripping for URL-based fact-checks
- `executeTool(name, input)`: Dispatcher called inside agentic loops

### Core Services
- **`src/fact-checker.ts`**: `factCheckArticle(text)` — orchestrates the full pipeline (extract → verify each claim → generate report). Used by `/text` and `/url` routes.
- **`src/types.ts`**: Shared TypeScript types (`Claim`, `VerificationResult`, `FactCheckReport`, etc.)
- **`src/middleware/`**: Express validator, error handler, logger

## Key Patterns
- **Agentic loop**: `runAgenticLoop()` in `src/agents/index.ts` handles `tool_use` stop reason — executes tools and feeds `tool_result` blocks back until `end_turn`
- **JSON-only Claude responses**: All agents instruct Claude to return only valid JSON; `cleanJsonResponse()` strips markdown code fences before `JSON.parse()`
- **SSE streaming**: `/stream` route sets `Content-Type: text/event-stream` and emits typed events (`status`, `claims_extracted`, `claim_verifying`, `claim_verified`, `complete`, `error`)
- **Reports persistence**: Saved as `reports/report-{uuid}.json` via `saveReport()` in `fact-checker.ts`

## Environment
- `ANTHROPIC_API_KEY`: Required for all Claude calls
- `SERPER_API_KEY`: Required for web search tool
- Model: `claude-sonnet-4-20250514`
- `npm run dev`: Watch mode via `tsx watch src/server.ts`
- `npm run build`: Compile TypeScript to `dist/`
