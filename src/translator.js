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

const LOCALE_NAMES = {
  en: "English",
  "pl-PL": "Polish",
  pl: "Polish",
  ru: "Russian",
  de: "German",
  fr: "French",
  es: "Spanish",
};

/**
 * Translate a set of fields from the source locale to target locales
 *
 * @param {Object} fields - { fieldApiKey: "source text", ... }
 * @param {string} sourceLocale - e.g. "pl-PL"
 * @param {string[]} targetLocales - e.g. ["en", "ru"]
 * @param {Object} options
 * @param {string} options.modelName - Name of the DatoCMS model for context
 * @returns {Object} - { en: { fieldApiKey: "translated", ... }, ru: { ... } }
 */
async function translateFields(fields, sourceLocale, targetLocales, options = {}) {
  const client = getAnthropicClient();
  const { modelName = "" } = options;
  const context = process.env.BUSINESS_CONTEXT || "";

  const sourceLang = LOCALE_NAMES[sourceLocale] || sourceLocale;
  const targetList = targetLocales
    .map((l) => `"${l}" (${LOCALE_NAMES[l] || l})`)
    .join(", ");

  // Build field list for the prompt
  const fieldEntries = Object.entries(fields).filter(([, value]) => value && value.trim());
  if (fieldEntries.length === 0) {
    return {};
  }

  const fieldsJson = JSON.stringify(
    Object.fromEntries(fieldEntries),
    null,
    2,
  );

  const systemPrompt = `You are a professional translator for a residential real estate developer website.

BUSINESS CONTEXT: ${context}

TRANSLATION RULES:
1. Translate naturally and fluently — not word-by-word. Adapt to the target language's conventions.
2. Preserve the original meaning, tone, and intent.
3. Keep proper nouns unchanged: investment names (Inverso, Stasinek, Sfera, Bursztynowa), city names (Warszawa/Warsaw/Варшава), district names.
4. For real estate terminology, use industry-standard terms in each language:
   - "mieszkania od dewelopera" → EN: "developer apartments" / RU: "квартиры от застройщика"
   - "domy segmentowe" → EN: "townhouses" or "semi-detached houses" / RU: "таунхаусы" or "сегментные дома"
   - "osiedle" → EN: "housing estate" or "residential complex" / RU: "жилой комплекс" or "осиeдле"
5. Keep HTML tags, markdown formatting, and structural elements intact.
6. Keep URLs, email addresses, and phone numbers unchanged.
7. Preserve line breaks and paragraph structure.
8. If the source text is very short (1-3 words like a label or button), translate concisely.
9. For SEO-relevant content (titles, descriptions), include natural SEO keywords in the target language.

You MUST respond with ONLY valid JSON. No other text, no markdown, no code blocks.`;

  const userPrompt = `Translate the following fields from ${sourceLang} (${sourceLocale}) to these languages: ${targetList}.
${modelName ? `\nContent model: "${modelName}" (use this for context about what the fields represent)\n` : ""}
Source fields (${sourceLang}):
${fieldsJson}

Respond with ONLY a JSON object in this exact format:
{
${targetLocales.map((l) => `  "${l}": { ${fieldEntries.map(([key]) => `"${key}": "translated text in ${LOCALE_NAMES[l] || l}"`).join(", ")} }`).join(",\n")}
}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
  });

  const responseText = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  let cleaned = responseText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    const translations = JSON.parse(cleaned);

    // Validate structure
    for (const locale of targetLocales) {
      if (!translations[locale]) {
        throw new Error(`Missing locale "${locale}" in response`);
      }
    }

    return translations;
  } catch (parseError) {
    console.error("Failed to parse translation response:", responseText);
    throw new Error(`Failed to parse translations: ${parseError.message}`);
  }
}

module.exports = { translateFields };
