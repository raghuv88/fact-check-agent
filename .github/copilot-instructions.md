# Fact-Check Agent - AI Coding Guidelines

## Project Overview
This TypeScript project demonstrates AI agent patterns for fact-checking using Anthropic's Claude API. It focuses on claim extraction, web search integration, and agentic reasoning loops.

## Architecture Components
- **Claim Extraction** (`src/claim-extractor.ts`): Uses Claude with detailed system prompts to categorize text claims as VERIFIABLE/OPINION/AMBIGUOUS
- **Tools Integration** (`src/tools-basic.ts`): Implements web search tools with DuckDuckGo API, enabling agentic fact-checking loops
- **Conversation Management**: Maintains message history for context-aware interactions
- **System Prompts**: Configurable prompts control Claude's behavior (expert vs beginner modes)

## Development Workflows
- `npm run dev`: Watch mode for development with `tsx watch src/index.ts`
- `npm run build`: Compile TypeScript to `dist/` directory
- Environment: Requires `ANTHROPIC_API_KEY` in `.env` file
- Model: Uses `claude-sonnet-4-20250514` for all interactions

## Key Patterns & Conventions
- **Tool Definitions**: Use Anthropic.Tool[] format with `input_schema` objects for tool parameters
- **Agentic Loops**: Handle `tool_use` stop_reason by executing tools and feeding results back as `tool_result` blocks
- **Message History**: Maintain conversation context using `Anthropic.MessageParam[]` arrays
- **Error Handling**: Wrap API calls in try/catch with descriptive console logging
- **System Prompts**: Define behavior through detailed system instructions, not user messages

## Code Examples
- Claim categorization: Extract atomic claims from text, split fact/opinion mixtures
- Tool execution: Map tool names to async functions, return string results
- Context retention: Push user/assistant messages to history array before each API call

## Integration Points
- Anthropic SDK: Primary interface for Claude interactions
- DuckDuckGo API: Free web search without authentication
- Axios: HTTP client for external API calls

Focus on building agentic capabilities by combining system prompts, tool use, and conversation context.