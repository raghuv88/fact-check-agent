import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

type Message = {
  role: "user" | "assistant";
  content: string;
};

/**
 * A configurable chat function with system prompt
 * System prompt = Instructions that guide Claude's behavior
 */
async function chatWithSystem(
  userMessage: string,
  systemPrompt: string,
  conversationHistory: Message[] = [],
): Promise<string> {
  // Add user message to history
  conversationHistory.push({
    role: "user",
    content: userMessage,
  });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: systemPrompt, // This is the key difference!
    messages: conversationHistory,
  });

  const assistantMessage = response.content[0];
  if (assistantMessage.type !== "text") {
    throw new Error("Unexpected response type");
  }

  const assistantText = assistantMessage.text;

  conversationHistory.push({
    role: "assistant",
    content: assistantText,
  });

  return assistantText;
}

/**
 * Demo: Same question, different system prompts = different behaviors
 */
async function demonstrateSystemPrompts() {
  console.log("=== System Prompt Demo ===\n");

  const question = "What is machine learning?";

  // Example 1: Expert technical mode
  console.log("📘 Scenario 1: Technical Expert Mode\n");
  const expertPrompt = `You are a technical expert in AI and machine learning. 
Provide detailed, technical explanations with specific terminology. 
Assume the user has programming experience.`;

  const expertResponse = await chatWithSystem(question, expertPrompt);
  console.log(`Question: ${question}`);
  console.log(`Response: ${expertResponse}\n`);

  console.log("\n" + "=".repeat(60) + "\n");

  // Example 2: Beginner-friendly mode
  console.log("📗 Scenario 2: Beginner-Friendly Mode\n");
  const beginnerPrompt = `You are a patient teacher explaining concepts to beginners.
Use simple language, everyday analogies, and avoid jargon.
Keep explanations concise and easy to understand.`;

  const beginnerResponse = await chatWithSystem(question, beginnerPrompt);
  console.log(`Question: ${question}`);
  console.log(`Response: ${beginnerResponse}\n`);

  console.log("\n" + "=".repeat(60) + "\n");

  // Example 3: Fact-checker mode (relevant to our project!)
  console.log("📕 Scenario 3: Fact-Checker Mode\n");
  const factCheckerPrompt = `You are a rigorous fact-checker.
For any claim, you must:
1. Identify if it's a factual claim or opinion
2. State what evidence would be needed to verify it
3. Indicate your confidence level
Be skeptical and precise.`;

  const factCheckQuestion = "The Earth is flat and NASA is hiding the truth.";
  const factCheckResponse = await chatWithSystem(
    factCheckQuestion,
    factCheckerPrompt,
  );
  console.log(`Statement: ${factCheckQuestion}`);
  console.log(`Response: ${factCheckResponse}\n`);
}

// Run the demo
demonstrateSystemPrompts();
