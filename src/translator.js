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

// ══════════════════════════════════════════════
// ── CORE: Single text translation with retry ──
// ══════════════════════════════════════════════

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

  const MAX_RETRIES = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const message = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      const responseText = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

      return responseText.trim();
    } catch (error) {
      lastError = error;
      const status = error.status || error.statusCode || 0;
      if ((status === 529 || status === 429) && attempt < MAX_RETRIES) {
        const delay = attempt * 3000;
        console.log(`  ⏳ API overloaded (${status}), retry ${attempt}/${MAX_RETRIES} in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// ══════════════════════════════════════════════
// ── Translate plain string/text fields ──
// ══════════════════════════════════════════════

async function translateFields(fields, sourceLocale, targetLocales, options = {}) {
  const { modelName = "" } = options;

  const fieldEntries = Object.entries(fields).filter(
    ([, value]) => value && typeof value === "string" && value.trim()
  );

  if (fieldEntries.length === 0) return {};

  const result = {};
  for (const locale of targetLocales) result[locale] = {};

  for (const [fieldApiKey, sourceText] of fieldEntries) {
    for (const targetLocale of targetLocales) {
      try {
        const translated = await translateSingleField(
          sourceText, sourceLocale, targetLocale,
          { modelName, fieldName: fieldApiKey }
        );
        result[targetLocale][fieldApiKey] = translated;
      } catch (error) {
        console.error(`  ⚠️  Failed to translate ${fieldApiKey} to ${targetLocale}: ${error.message}`);
        result[targetLocale][fieldApiKey] = null;
      }
    }
  }

  return result;
}

// ══════════════════════════════════════════════
// ── STRUCTURED TEXT (DAST) translation ──
// ══════════════════════════════════════════════

/**
 * Extract full paragraph text from a DAST node's children (spans).
 * Used as context when translating individual spans.
 */
function extractTextFromChildren(children) {
  if (!Array.isArray(children)) return "";
  return children
    .filter((c) => c.type === "span" && c.value)
    .map((c) => c.value)
    .join("");
}

/**
 * Deep clone a DAST tree.
 */
function cloneDast(node) {
  return JSON.parse(JSON.stringify(node));
}

/**
 * Translate a DAST (Structured Text) tree.
 *
 * Strategy:
 * - Walk the tree recursively
 * - For each paragraph/heading/listItem/blockquote: collect all span texts
 * - If single span → translate directly
 * - If multiple spans → translate each span with full paragraph context
 * - Skip: block references, inlineItem, code blocks, thematicBreak
 * - Preserve: all structure, marks, URLs, IDs
 *
 * @param {Object} dast - The DAST object (with type "root" and children)
 * @param {string} sourceLocale
 * @param {string} targetLocale
 * @param {Object} options
 * @returns {Object} - Translated DAST tree (deep clone)
 */
async function translateDast(dast, sourceLocale, targetLocale, options = {}) {
  if (!dast || !dast.children) return dast;

  const translated = cloneDast(dast);
  await translateDastNode(translated, sourceLocale, targetLocale, options);
  return translated;
}

/**
 * Recursively translate DAST nodes in-place.
 */
async function translateDastNode(node, sourceLocale, targetLocale, options) {
  if (!node || !node.children) return;

  for (const child of node.children) {
    // Skip non-translatable nodes
    if (child.type === "block" || child.type === "inlineItem" || child.type === "thematicBreak") {
      continue;
    }

    // Code blocks — don't translate code
    if (child.type === "code") {
      continue;
    }

    // Nodes with span children: paragraph, heading, link, itemLink
    if (["paragraph", "heading"].includes(child.type)) {
      await translateSpanChildren(child, sourceLocale, targetLocale, options);
      continue;
    }

    // Link / itemLink — translate link text (spans), keep URL/item
    if (child.type === "link" || child.type === "itemLink") {
      await translateSpanChildren(child, sourceLocale, targetLocale, options);
      continue;
    }

    // Container nodes: list, listItem, blockquote — recurse
    if (child.children) {
      await translateDastNode(child, sourceLocale, targetLocale, options);
    }
  }
}

/**
 * Translate span children of a paragraph/heading/link node.
 *
 * Single span: translate the value directly.
 * Multiple spans: translate each span individually with full paragraph context
 * for better quality (preserves formatting marks on each span).
 */
async function translateSpanChildren(node, sourceLocale, targetLocale, options) {
  if (!node.children || node.children.length === 0) return;

  // Collect spans and non-span children (like nested links in paragraphs)
  const spans = [];
  const nonSpanChildren = [];

  for (const child of node.children) {
    if (child.type === "span" && typeof child.value === "string" && child.value.trim()) {
      spans.push(child);
    } else if (child.type === "link" || child.type === "itemLink") {
      // Nested links inside paragraphs — recurse into them
      nonSpanChildren.push(child);
    }
  }

  // Translate nested links
  for (const linkNode of nonSpanChildren) {
    await translateSpanChildren(linkNode, sourceLocale, targetLocale, options);
  }

  if (spans.length === 0) return;

  // Single span — translate directly
  if (spans.length === 1) {
    try {
      spans[0].value = await translateSingleField(
        spans[0].value, sourceLocale, targetLocale, options
      );
    } catch (e) {
      console.error(`  ⚠️  DAST span translate failed: ${e.message}`);
    }
    return;
  }

  // Multiple spans — translate each with full paragraph as context
  const fullText = spans.map((s) => s.value).join("");

  for (const span of spans) {
    if (!span.value.trim()) continue; // skip whitespace-only spans

    try {
      span.value = await translateSingleField(
        span.value, sourceLocale, targetLocale,
        {
          ...options,
          fieldName: (options.fieldName || "") + " (paragraph context: " + fullText.substring(0, 200) + ")",
        }
      );
    } catch (e) {
      console.error(`  ⚠️  DAST span translate failed: ${e.message}`);
    }
  }
}

/**
 * Translate a Structured Text field for all target locales.
 *
 * @param {Object} dast - Source DAST tree
 * @param {string} sourceLocale
 * @param {string[]} targetLocales
 * @param {Object} options
 * @returns {Object} - { en: <translated DAST>, ru: <translated DAST> }
 */
async function translateStructuredTextField(dast, sourceLocale, targetLocales, options = {}) {
  const result = {};

  for (const targetLocale of targetLocales) {
    try {
      result[targetLocale] = await translateDast(dast, sourceLocale, targetLocale, options);
    } catch (error) {
      console.error(`  ⚠️  DAST translation to ${targetLocale} failed: ${error.message}`);
      result[targetLocale] = null;
    }
  }

  return result;
}

// ══════════════════════════════════════════════
// ── SEO field translation ──
// ══════════════════════════════════════════════

/**
 * Translate a DatoCMS SEO field.
 * SEO fields have: { title, description, image, twitter_card }
 * We only translate title and description.
 *
 * @param {Object} seoObj - Source SEO object
 * @param {string} sourceLocale
 * @param {string[]} targetLocales
 * @param {Object} options
 * @returns {Object} - { en: { title, description, image, twitter_card }, ru: { ... } }
 */
async function translateSeoField(seoObj, sourceLocale, targetLocales, options = {}) {
  if (!seoObj) return {};

  const result = {};

  for (const targetLocale of targetLocales) {
    const translated = { ...seoObj }; // copy image, twitter_card, etc.

    if (seoObj.title && typeof seoObj.title === "string" && seoObj.title.trim()) {
      try {
        translated.title = await translateSingleField(
          seoObj.title, sourceLocale, targetLocale,
          { ...options, fieldName: "seo_title" }
        );
      } catch (e) {
        console.error(`  ⚠️  SEO title translate to ${targetLocale} failed: ${e.message}`);
      }
    }

    if (seoObj.description && typeof seoObj.description === "string" && seoObj.description.trim()) {
      try {
        translated.description = await translateSingleField(
          seoObj.description, sourceLocale, targetLocale,
          { ...options, fieldName: "seo_description" }
        );
      } catch (e) {
        console.error(`  ⚠️  SEO description translate to ${targetLocale} failed: ${e.message}`);
      }
    }

    result[targetLocale] = translated;
  }

  return result;
}

module.exports = {
  translateFields,
  translateSingleField,
  translateStructuredTextField,
  translateSeoField,
};
