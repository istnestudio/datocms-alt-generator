const Anthropic = require("@anthropic-ai/sdk");

let anthropicClient = null;

function getAnthropicClient() {
  if (!anthropicClient) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

/**
 * Build the system prompt for ALT text generation
 */
function buildSystemPrompt() {
  const context = process.env.BUSINESS_CONTEXT || "business website";
  return `You are an expert accessibility and SEO specialist generating ALT texts for images and videos on a website.

BUSINESS CONTEXT: ${context}

RULES FOR ALT TEXT:
1. Be descriptive but concise (80-150 characters ideally, max 200 characters)
2. Describe what is visually present in the image/video frame
3. Include relevant SEO keywords naturally when they fit the visual content
4. For real estate: mention building type, architectural features, interior elements, location context if visible
5. Do NOT start with "Image of..." or "Photo of..." — describe the content directly
6. Do NOT include text that is already visible in the image (like watermarks or logos) unless it's the main subject
7. Be specific: "Modern apartment living room with panoramic city view" is better than "Room interior"
8. For video thumbnails: describe the key visual scene

You MUST respond with ONLY valid JSON. No other text, no markdown, no code blocks.`;
}

/**
 * Generate ALT texts for an image in multiple locales
 *
 * @param {string} imageUrl - URL of the image
 * @param {string[]} locales - Array of locale codes, e.g. ["en", "pl", "ru"]
 * @param {string} filename - Original filename for additional context
 * @param {string} mediaType - "image" or "video"
 * @returns {Object} - { en: "...", pl: "...", ru: "..." }
 */
async function generateAltTexts(imageUrl, locales, filename = "", mediaType = "image") {
  const client = getAnthropicClient();

  const localeNames = {
    en: "English",
    pl: "Polish",
    ru: "Russian",
    de: "German",
    fr: "French",
    es: "Spanish",
    it: "Italian",
    uk: "Ukrainian",
    cs: "Czech",
  };

  const localeList = locales
    .map((l) => `"${l}" (${localeNames[l] || l})`)
    .join(", ");

  const userPrompt = `Analyze this ${mediaType} and generate SEO-optimized ALT text in these languages: ${localeList}.

Filename for context: "${filename}"

Respond with ONLY a JSON object in this exact format (no markdown, no code blocks):
{${locales.map((l) => `"${l}": "ALT text in ${localeNames[l] || l}"`).join(", ")}}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: buildSystemPrompt(),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "url",
              url: imageUrl,
            },
          },
          {
            type: "text",
            text: userPrompt,
          },
        ],
      },
    ],
  });

  // Extract the text response
  const responseText = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  // Parse JSON from response (handle potential markdown code blocks)
  let cleaned = responseText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    const altTexts = JSON.parse(cleaned);

    // Validate all locales are present
    for (const locale of locales) {
      if (!altTexts[locale]) {
        throw new Error(`Missing locale "${locale}" in response`);
      }
      // Trim to max 200 chars
      if (altTexts[locale].length > 200) {
        altTexts[locale] = altTexts[locale].substring(0, 197) + "...";
      }
    }

    return altTexts;
  } catch (parseError) {
    console.error("Failed to parse Claude response:", responseText);
    throw new Error(`Failed to parse ALT texts: ${parseError.message}`);
  }
}

module.exports = { generateAltTexts };
