import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Define TypeScript types for our output
type ClaimCategory = "VERIFIABLE" | "OPINION" | "AMBIGUOUS";

interface Claim {
  claim: string;
  category: ClaimCategory;
  reason: string;
  source_reference?: string; // Where in the article (optional)
}

interface ClaimExtractionResult {
  claims: Claim[];
  total_count: number;
}

// System prompt - this is your instruction refined
const CLAIM_EXTRACTOR_SYSTEM = `You are a Claim Extraction Agent.

Your job:
1) Extract all distinct claims from the input text.
2) Categorize each claim as one of:
   - VERIFIABLE: Can be checked against reliable sources or data (dates, facts, statistics, events, quotes).
   - OPINION: A value judgment, preference, prediction, or subjective statement not provable as true/false.
   - AMBIGUOUS: Unclear meaning, missing key details (who/what/when/where), vague quantifiers ("many", "soon"), or depends on undefined terms.

Rules:
- Extract claims even if they are likely false.
- Do NOT add new facts or claims not in the text.
- Split compound claims into multiple atomic claims.
- If the text quotes someone, treat quoted statements as claims attributed to that speaker.
- If a claim mixes fact + opinion, split into separate claims.
- If a claim is phrased as a question but implies an assertion, extract the implied claim.

For each claim, output a JSON object with:
{
  "claim": "The exact claim as a single sentence",
  "category": "VERIFIABLE | OPINION | AMBIGUOUS",
  "reason": "Brief explanation of why it falls in this category",
  "source_reference": "Quote the relevant part of the original text (optional)"
}

Output format:
{
  "claims": [array of claim objects],
  "total_count": number
}

Output ONLY valid JSON. No markdown, no commentary, no preamble.`;

/**
 * Extract and classify claims from article text
 */
async function extractClaims(
  articleText: string,
): Promise<ClaimExtractionResult> {
  console.log("📄 Analyzing article...\n");
  console.log("Article text:");
  console.log("-".repeat(60));
  console.log(articleText);
  console.log("-".repeat(60));
  console.log("\n⚙️ Extracting claims...\n");

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: CLAIM_EXTRACTOR_SYSTEM,
      messages: [
        {
          role: "user",
          content: articleText,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    // Parse the JSON response
    const result: ClaimExtractionResult = JSON.parse(content.text);

    // Display results
    console.log("✅ Claims extracted successfully!\n");
    console.log(`Total claims found: ${result.total_count}\n`);

    result.claims.forEach((claim, index) => {
      const emoji =
        claim.category === "VERIFIABLE"
          ? "✓"
          : claim.category === "OPINION"
            ? "💭"
            : "❓";

      console.log(`${emoji} Claim ${index + 1}: [${claim.category}]`);
      console.log(`   "${claim.claim}"`);
      console.log(`   Reason: ${claim.reason}`);
      if (claim.source_reference) {
        console.log(`   Source: "${claim.source_reference}"`);
      }
      console.log();
    });

    return result;
  } catch (error) {
    console.error("❌ Error extracting claims:", error);
    throw error;
  }
}

/**
 * Test with different article types
 */
async function runTests() {
  console.log("=== CLAIM EXTRACTION TESTS ===\n\n");

  // Test 1: Mix of facts and opinions
  console.log("TEST 1: Mixed Facts and Opinions\n");
  const test1 = `
The Eiffel Tower is located in Paris, France. 
It's the most beautiful structure in the world.
It was completed in 1889 for the World's Fair.
Many experts believe it will stand for at least another 100 years.
`;
  await extractClaims(test1);

  console.log("\n" + "=".repeat(80) + "\n\n");

  // Test 2: News article style with quotes
  console.log("TEST 2: News Article with Quotes\n");
  const test2 = `
The CEO announced that the company's revenue increased by 25% last quarter.
"This is our best performance ever," said the CEO during the earnings call.
The stock price will likely continue to rise according to analysts.
The company employs over 10,000 people worldwide.
`;
  await extractClaims(test2);

  console.log("\n" + "=".repeat(80) + "\n\n");

  // Test 3: Ambiguous claims
  console.log("TEST 3: Ambiguous and Vague Claims\n");
  const test3 = `
Many people think the new policy is bad.
The situation will improve soon.
Experts agree that something needs to be done.
Studies show that this approach works better.
`;
  await extractClaims(test3);
}

// Run the tests
runTests();
