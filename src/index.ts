import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Initialize the Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function main() {
  console.log("🤖 Calling Claude...\n");

  try {
    // Make your first API call
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content:
            "Hello Claude! Please introduce yourself and explain what you can help me with in 2-3 sentences.",
        },
      ],
    });

    // Extract and display the response
    const response = message.content[0];
    if (response.type === "text") {
      console.log("Claude says:\n");
      console.log(response.text);
    }

    console.log("\n📊 Usage Stats:");
    console.log(`Input tokens: ${message.usage.input_tokens}`);
    console.log(`Output tokens: ${message.usage.output_tokens}`);
    console.log(
      `Total tokens: ${message.usage.input_tokens + message.usage.output_tokens}`,
    );
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

// Run the program
main();
