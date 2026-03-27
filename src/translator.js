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
 * Translate a single text from source locale to a single target locale.
 *
 * @param {string} text - Source text to translate
 * @param {string} sourceLocale - e.g. "pl-PL"
 * @param {string} targetLocale - e.g. "en"
 * @param {Object} options
 * @param {string} options.modelName - DatoCMS model name for context
 * @param {string} options.fieldName - Field API key for context
 * @returns {string} - Translated text
 */
async function translateSingleField(text, sourceLocale, targetLocale, options = {}) {
  const client = getAnthropicClient();
  const { modelName = "", fieldName = "" } = options;
  const context = process.env.BUSINESS_CONTEXT || "";

  const sourceLang = LOCALE_NAMES[sourceLocale] || sourceLocale;
  const targetLang = LOCALE_NAMES[targetLocale] || targetLocale;

  const systemPrompt = `You are a professional translator for a residential real estate developer website.

BUSINESS CONTEXT: ${context}

TRANSLATION RULES:
1. Translate naturally and fluently — not word-by-word. Adapt to the target language's conventions.
2. Preserve the original meaning, tone, and intent.
3. Keep proper nouns unchanged: investment names (Inverso, Stasinek, Sfera, Bursztynowa), city names (Warszawa/Warsaw/Варшава), district names.
4. For real estate terminology, use industry-standard terms:
   - "mieszkania od dewelopera" → EN: "developer apartments" / RU: "квартиры от застройщика"
   - "domy segmentowe" → EN: "townhouses" or "semi-detached houses" / RU: "таунхаусы"
   - "osiedle" → EN: "housing estate" or "residential complex" / RU: "жилой комплекс"
5. Keep ALL HTML tags, markdown formatting, and structural elements EXACTLY as they are.
6. Keep URLs, email addresses, and phone numbers unchanged.
7. Preserve line breaks and paragraph structure exactly.
8. If the source text is very short (1-3 words like a label or button), translate concisely.
9. For SEO-relevant content (titles, descriptions), include natural SEO keywords in the target language.

CRITICAL: Respond with ONLY the translated text. No quotes around it, no explanation, no prefix like "Translation:". Just the pure translated text.`;

  const userPrompt = `Translate the following ${sourceLang} text to ${targetLang}.${modelName ? ` This is the "${fieldName}" field in a "${modelName}" content type.` : ""}

---
${text}
---`;

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

  return responseText.trim();
}

/**
 * Translate a set of fields from the source locale to target locales.
 * Translates each field individually for reliability.
 *
 * @param {Object} fields - { fieldApiKey: "source text", ... }
 * @param {string} sourceLocale - e.g. "pl-PL"
 * @param {string[]} targetLocales - e.g. ["en", "ru"]
 * @param {Object} options
 * @param {string} options.modelName - Name of the DatoCMS model for context
 * @returns {Object} - { en: { fieldApiKey: "translated", ... }, ru: { ... } }
 */
async function translateFields(fields, sourceLocale, targetLocales, options = {}) {
  const { modelName = "" } = options;

  const fieldEntries = Object.entries(fields).filter(
    ([, value]) => value && typeof value === "string" && value.trim()
  );

  if (fieldEntries.length === 0) {
    return {};
  }

  const result = {};
  for (const locale of targetLocales) {
    result[locale] = {};
  }

  // Translate each field to each target locale individually
  for (const [fieldApiKey, sourceText] of fieldEntries) {
    for (const targetLocale of targetLocales) {
      try {
        const translated = await translateSingleField(
          sourceText,
          sourceLocale,
          targetLocale,
          { modelName, fieldName: fieldApiKey }
        );
        result[targetLocale][fieldApiKey] = translated;
      } catch (error) {
        console.error(`  ⚠️  Failed to translate ${fieldApiKey} to ${targetLocale}: ${error.message}`);
        // Skip this field/locale combo, don't break the whole batch
        result[targetLocale][fieldApiKey] = null;
      }
    }
  }

  return result;
}

module.exports = { translateFields, translateSingleField };
