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
- **AI**: Anthropic Claude (`claude-sonnet-4-20250514`)
- **Web Search**: Serper API (Google Search)
- **API**: Express.js 5

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
| `claim_verified` | After each claim is verified | `{ type, result, index, total }` |
| `complete` | All done | `{ type, report, job_id }` |
| `error` | On failure | `{ type, message }` |

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

## Project Structure

```
src/
├── agents/         # Claim extractor, fact verifier, report generator agents
├── tools/          # Web search and article fetching tools
├── routes/         # API endpoint handlers
├── middleware/      # Error handling and request logging
├── fact-checker.ts # Main orchestration logic
├── server.ts       # Express server entry point
└── types.ts        # TypeScript interfaces
```

## Scripts

```bash
npm run dev        # Start dev server with hot reload
npm start          # Start production server
npm run build      # Compile TypeScript
npm run fact-check # Run CLI fact-checker
```
