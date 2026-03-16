import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Define the Message type for our conversation history
type Message = {
  role: "user" | "assistant";
  content: string;
};

// Conversation history - like maintaining session state
const conversationHistory: Message[] = [];

/**
 * Send a message to Claude and get a response
 * This maintains conversation context across calls
 */
async function chat(userMessage: string): Promise<string> {
  console.log(`\n👤 You: ${userMessage}`);

  // Add user message to history
  conversationHistory.push({
    role: "user",
    content: userMessage,
  });

  try {
    // Send entire conversation history to Claude
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: conversationHistory,
    });

    // Extract Claude's response
    const assistantMessage = response.content[0];
    if (assistantMessage.type !== "text") {
      throw new Error("Unexpected response type");
    }

    const assistantText = assistantMessage.text;

    // Add Claude's response to history
    conversationHistory.push({
      role: "assistant",
      content: assistantText,
    });

    console.log(`\n🤖 Claude: ${assistantText}`);

    return assistantText;
  } catch (error) {
    console.error("❌ Error:", error);
    throw error;
  }
}

/**
 * Example: Multi-turn conversation demonstrating context retention
 */
async function demonstrateConversation() {
  console.log("=== Conversation Context Demo ===\n");
  console.log("This shows how Claude remembers previous messages\n");

  // Turn 1: Introduce yourself
  await chat("My name is Raghu and I am learning about AI agents.");

  // Turn 2: Ask a follow-up (Claude should remember your name)
  await chat("What is my name?");

  // Turn 3: Reference previous context
  await chat("What was I learning about?");

  // Turn 4: Complex multi-step question
  await chat("Can you summarize our conversation so far in one sentence?");

  // Show the full conversation history
  console.log("\n\n=== Full Conversation History ===");
  console.log(JSON.stringify(conversationHistory, null, 2));

  console.log(`\n📊 Total messages in history: ${conversationHistory.length}`);
}

// Run the demo
demonstrateConversation();
