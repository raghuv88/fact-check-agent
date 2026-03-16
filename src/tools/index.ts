import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import * as dotenv from "dotenv";
import { ArticleContent } from "../types.js";

dotenv.config();

/**
 * Tool definitions for Claude
 */
export const tools: Anthropic.Tool[] = [
  {
    name: "search_web",
    description:
      "Search the web for information to verify facts. Returns search results with snippets and sources. Use specific, focused queries.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query. Be specific and include key terms (names, dates, locations, etc.).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_article",
    description:
      "Fetch the full content of an article from a URL. Returns the article text, title, and metadata.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL of the article to fetch",
        },
      },
      required: ["url"],
    },
  },
];

/**
 * Search the web using Serper (Google Search API)
 * Better than DuckDuckGo for fact-checking
 */
export async function searchWeb(query: string): Promise<string> {
  console.log(`  🔍 Searching: "${query}"`);

  const SERPER_API_KEY = process.env.SERPER_API_KEY;

  if (!SERPER_API_KEY) {
    console.error("  ⚠️  SERPER_API_KEY not found in .env file");
    return "Error: SERPER_API_KEY not configured. Please add it to your .env file.";
  }

  try {
    const response = await axios.post(
      "https://google.serper.dev/search",
      {
        q: query,
        num: 5, // Number of results
      },
      {
        headers: {
          "X-API-KEY": SERPER_API_KEY,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      },
    );

    const data = response.data;
    let result = "";

    // Answer box (direct answer from Google)
    if (data.answerBox) {
      result += "📌 Direct Answer:\n";
      if (data.answerBox.answer) {
        result += `${data.answerBox.answer}\n`;
      }
      if (data.answerBox.snippet) {
        result += `${data.answerBox.snippet}\n`;
      }
      if (data.answerBox.snippetHighlighted) {
        result += `Highlight: ${data.answerBox.snippetHighlighted.join(" ")}\n`;
      }
      result += "\n";
    }

    // Knowledge graph (for entities like people, places, companies)
    if (data.knowledgeGraph) {
      result += "📚 Knowledge Graph:\n";
      if (data.knowledgeGraph.title) {
        result += `Title: ${data.knowledgeGraph.title}\n`;
      }
      if (data.knowledgeGraph.description) {
        result += `Description: ${data.knowledgeGraph.description}\n`;
      }
      if (data.knowledgeGraph.attributes) {
        Object.entries(data.knowledgeGraph.attributes).forEach(
          ([key, value]) => {
            result += `${key}: ${value}\n`;
          },
        );
      }
      result += "\n";
    }

    // Organic search results
    if (data.organic && data.organic.length > 0) {
      result += "🔎 Search Results:\n\n";
      data.organic.slice(0, 5).forEach((item: any, idx: number) => {
        result += `${idx + 1}. ${item.title}\n`;
        if (item.snippet) {
          result += `   ${item.snippet}\n`;
        }
        if (item.link) {
          result += `   Source: ${item.link}\n`;
        }
        if (item.date) {
          result += `   Date: ${item.date}\n`;
        }
        result += "\n";
      });
    }

    if (!result.trim()) {
      result = `No results found for "${query}". The search may be too specific or the topic may be very recent.`;
    }

    console.log(`  ✅ Found ${data.organic?.length || 0} results`);
    return result;
  } catch (error: any) {
    console.error("  ❌ Search error:", error.response?.data || error.message);
    if (error.response?.status === 401) {
      return "Error: Invalid SERPER_API_KEY. Please check your API key in .env file.";
    }
    return `Error searching: ${error.message}`;
  }
}

/**
 * Fetch article content from URL
 * Note: This is a simplified version. In production, you'd use a proper web scraping service
 */
export async function fetchArticle(url: string): Promise<string> {
  console.log(`  📄 Fetching article: ${url}`);

  try {
    // For demo purposes, we'll use a simple HTTP GET
    // In production, use a service like Diffbot, Readability API, or Jina AI Reader
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FactChecker/1.0)",
      },
    });

    // Very basic HTML text extraction (not production-ready!)
    let text = response.data;

    // Remove script and style tags
    text = text.replace(
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      "",
    );
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, " ");

    // Clean up whitespace
    text = text.replace(/\s+/g, " ").trim();

    // Limit length
    text = text.substring(0, 5000);

    if (!text || text.length < 100) {
      return `Unable to extract meaningful content from ${url}. The page may be JavaScript-rendered or protected.`;
    }

    const result: ArticleContent = {
      url,
      content: text,
      fetch_timestamp: new Date().toISOString(),
    };

    return JSON.stringify(result, null, 2);
  } catch (error) {
    console.error("  ❌ Fetch error:", error);
    return `Error fetching article from ${url}: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

/**
 * Execute a tool by name
 */
export async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
): Promise<string> {
  switch (toolName) {
    case "search_web":
      return await searchWeb(toolInput.query);
    case "fetch_article":
      return await fetchArticle(toolInput.url);
    default:
      return `Error: Unknown tool "${toolName}"`;
  }
}
