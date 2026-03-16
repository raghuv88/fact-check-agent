import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Alternative approach: Use Anthropic's built-in web search
 * This is simpler - no external API needed!
 */

export const toolsWithWebSearch: Anthropic.Tool[] = [
  {
    type: "web_search_20250305",
    name: "web_search",
  } as any, // Type assertion because TypeScript doesn't recognize this yet
];

/**
 * Example of using Claude's built-in search in an agent
 */
export async function searchWithClaude(query: string): Promise<string> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  console.log(`  🔍 Searching with Claude: "${query}"`);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    tools: toolsWithWebSearch,
    messages: [
      {
        role: "user",
        content: `Search the web and answer: ${query}. Provide sources and be specific.`,
      },
    ],
  });

  // Extract text response
  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );

  return textBlock?.text || "No results found";
}

/**
 * Use this in your agents instead of custom search
 */
export async function verifyWithBuiltInSearch(claim: string): Promise<any> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const systemPrompt = `You are a fact-checking agent. 
Use web search to verify claims. 
Provide verdicts as JSON: {"verdict": "TRUE|FALSE|PARTIALLY_TRUE|UNVERIFIABLE", "confidence": "HIGH|MEDIUM|LOW", "explanation": "...", "sources": [...]}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: systemPrompt,
    tools: toolsWithWebSearch,
    messages: [
      {
        role: "user",
        content: `Verify this claim using web search: "${claim}"`,
      },
    ],
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );

  return textBlock?.text || "{}";
}
