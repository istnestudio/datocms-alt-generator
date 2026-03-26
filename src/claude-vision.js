const Anthropic = require("@anthropic-ai/sdk");
const { buildInvestmentContext } = require("./investment-matcher");

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
function buildSystemPrompt(filename) {
  const context = process.env.BUSINESS_CONTEXT || "business website";
  const investmentContext = buildInvestmentContext(filename);

  return `You are an expert accessibility and SEO specialist generating ALT texts for images and videos on a residential real estate developer website.

BUSINESS CONTEXT: ${context}
${investmentContext}
SEO KEYWORDS TO USE NATURALLY (when relevant to what's visible):
- Polish: mieszkania od dewelopera, nowe mieszkania Warszawa, osiedle mieszkaniowe, domy segmentowe, inwestycja deweloperska, mieszkania na sprzedaż
- English: new apartments Warsaw, residential development, housing estate, developer apartments
- Russian: новые квартиры Варшава, жилой комплекс, квартиры от застройщика

RULES FOR ALT TEXT:
1. Be descriptive but concise (80-150 characters ideally, max 200 characters)
2. Describe what is visually present — architecture, interiors, surroundings, amenities
3. Include SEO keywords naturally ONLY when they match the visual content. Never force keywords that don't relate to the image.
4. If an investment was matched from the filename, ALWAYS use its correct name, type (dom segmentowy vs blok mieszkalny) and location in the ALT text. Trust the investment data over visual appearance.
5. For building exteriors: mention building type (blok mieszkalny, dom segmentowy), architectural style, surroundings
6. For interiors: mention room type, layout features, finishes, natural light, view if visible
7. For surroundings/amenities: mention green areas, playgrounds, parking, neighborhood context
8. For renders/visualizations: add "wizualizacja" (PL) / "visualization" (EN) / "визуализация" (RU)
9. Do NOT start with "Image of...", "Photo of...", "Zdjęcie..." — describe the content directly
10. Do NOT include watermark or logo text unless it's the main subject
11. Be specific: "Nowoczesny salon w domu segmentowym na osiedlu Stasinek, Białołęka" is better than "Wnętrze domu"

You MUST respond with ONLY valid JSON. No other text, no markdown, no code blocks.`;
}

/**
 * Generate ALT texts for an image in multiple locales
 *
 * @param {string} imageUrl - URL of the image
 * @param {string[]} locales - Array of locale codes, e.g. ["en", "pl-PL", "ru"]
 * @param {string} filename - Original filename for additional context
 * @param {string} mediaType - "image" or "video"
 * @returns {Object} - { en: "...", "pl-PL": "...", ru: "..." }
 */
async function generateAltTexts(imageUrl, locales, filename = "", mediaType = "image") {
  const client = getAnthropicClient();

  const localeNames = {
    en: "English",
    "pl-PL": "Polish",
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
    system: buildSystemPrompt(filename),
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
