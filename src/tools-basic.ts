import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Real web search using DuckDuckGo's instant answer API
 * This is a simple, free API that doesn't require keys
 */
async function searchWeb(query: string): Promise<string> {
  console.log(`🔍 Searching web for: "${query}"`);

  try {
    // Using DuckDuckGo instant answer API (free, no key needed)
    const response = await axios.get("https://api.duckduckgo.com/", {
      params: {
        q: query,
        format: "json",
        no_html: 1,
        skip_disambig: 1,
      },
    });

    const data = response.data;

    // Build result from available data
    let result = "";

    if (data.AbstractText) {
      result += `Summary: ${data.AbstractText}\n`;
    }

    if (data.AbstractURL) {
      result += `Source: ${data.AbstractURL}\n`;
    }

    // Related topics
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      result += "\nRelated Information:\n";
      data.RelatedTopics.slice(0, 3).forEach((topic: any, idx: number) => {
        if (topic.Text) {
          result += `${idx + 1}. ${topic.Text}\n`;
        }
      });
    }

    if (!result) {
      result = `No detailed information found for "${query}". Try rephrasing the search query.`;
    }

    console.log(`📤 Search results received\n`);
    return result;
  } catch (error) {
    console.error("❌ Search error:", error);
    return `Error searching for "${query}": ${error}`;
  }
}

/**
 * Tool definitions
 */
const tools: Anthropic.Tool[] = [
  {
    name: "search_web",
    description:
      "Search the web for factual information. Use this to verify claims, find sources, check dates, statistics, or any verifiable facts. Returns summary and sources.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The search query. Be specific and include key terms (names, dates, places).",
        },
      },
      required: ["query"],
    },
  },
];

/**
 * Execute tool
 */
async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
): Promise<string> {
  console.log(`⚙️ Executing tool: ${toolName}`);
  console.log(`📥 Input: ${JSON.stringify(toolInput)}\n`);

  let result: string;

  switch (toolName) {
    case "search_web":
      result = await searchWeb(toolInput.query);
      break;
    default:
      result = `Error: Unknown tool ${toolName}`;
  }

  return result;
}

/**
 * Agentic fact-checking loop
 */
async function factCheck(claim: string): Promise<string> {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🎯 Fact-checking claim: "${claim}"`);
  console.log("=".repeat(80) + "\n");

  const systemPrompt = `You are a fact-checking assistant. 
When given a claim, you should:
1. Search the web to find evidence
2. Evaluate the evidence carefully
3. Provide a verdict: TRUE, FALSE, PARTIALLY TRUE, or UNVERIFIABLE
4. Explain your reasoning with sources

Be thorough and search multiple times if needed to verify different aspects of the claim.`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Please fact-check this claim: "${claim}"`,
    },
  ];

  let response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: systemPrompt,
    tools: tools,
    messages: messages,
  });

  console.log("🤖 Assistant response content:", response.content);
  console.log("🤖 Claude is analyzing...\n");

  // Agentic loop
  let iterationCount = 0;
  const maxIterations = 5; // Prevent infinite loops

  while (
    response.stop_reason === "tool_use" &&
    iterationCount < maxIterations
  ) {
    iterationCount++;
    console.log(`🔄 Iteration ${iterationCount}\n`);

    // Find ALL tool use blocks
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      break;
    }

    console.log(`🔧 Processing ${toolUseBlocks.length} tool(s)\n`);

    // Add assistant's response to conversation
    messages.push({
      role: "assistant",
      content: response.content,
    });

    console.log("📝 Added assistant message to conversation");

    // Execute ALL tools and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUseBlock of toolUseBlocks) {
      const toolResult = await executeTool(
        toolUseBlock.name,
        toolUseBlock.input,
      );

      console.log("🔧 Tool result:", toolResult);

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUseBlock.id,
        content: toolResult,
      });
    }

    // Add ALL tool results in one message
    messages.push({
      role: "user",
      content: toolResults,
    });

    console.log("📝 Added user message (tool results) to conversation");

    // Get next response
    response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: systemPrompt,
      tools: tools,
      messages: messages,
    });

    console.log("🤖 Assistant response content:", response.content);
  }

  // Extract final answer
  const finalTextBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );

  const verdict = finalTextBlock?.text || "Unable to determine";

  console.log(`\n${"=".repeat(80)}`);
  console.log("📋 FACT-CHECK RESULT:");
  console.log("=".repeat(80));
  console.log(verdict);
  console.log("=".repeat(80) + "\n");

  return verdict;
}

/**
 * Test fact-checking with real search
 */
async function runFactCheckTests() {
  console.log("=== REAL WEB SEARCH FACT-CHECKING ===\n");

  // Test 1: Verifiable fact
  await factCheck("The Eiffel Tower was completed in 1889.");

  // Test 2: False claim
  await factCheck("The Eiffel Tower is located in London.");

  // Test 3: Partially true
  await factCheck("The Eiffel Tower is 400 meters tall.");
}

// Run tests
runFactCheckTests();
