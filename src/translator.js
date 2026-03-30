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

CRITICAL: Respond with ONLY the translated text. No quotes around it, no explanation, no prefix like "Translation:". Just the pure translated text. NEVER include "---" separators in your response.`;

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

      // Strip any "---" separators that Claude might echo back from the prompt
      let result = responseText.trim();
      result = result.replace(/^---\n?/, "").replace(/\n?---$/, "").trim();
      return result;
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

// DatoCMS Structured Text field format:
// {
//   schema: "dast",
//   document: { type: "root", children: [...] },
//   blocks: [ { id, item_type, title, description, ... } ],
//   links: [ ... ]
// }

/**
 * Deep clone any object.
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Block types that need specific fields translated.
 * Key = block model API key, Value = array of field API keys to translate.
 */
const TRANSLATABLE_BLOCK_FIELDS = {
  data1: ["title", "description", "link_name"],
  text_accordion: ["title", "description"],
  button: ["title"],
};

/**
 * Translate a full DatoCMS Structured Text field value.
 *
 * Input: { schema: "dast", document: { type: "root", children: [...] }, blocks: [...], links: [...] }
 * Output: same structure with translated spans + translated block fields.
 *
 * @param {Object} structuredText - Full structured text value (schema + document + blocks + links)
 * @param {string} sourceLocale
 * @param {string} targetLocale
 * @param {Object} options
 * @returns {Object} - Translated structured text value
 */
/**
 * Translate a full DatoCMS Structured Text value.
 *
 * Handles document tree (paragraphs, headings, lists) translation.
 * Block handling is done externally by server.js which has CMA client access
 * to fetch block records and create new ones.
 *
 * @param {Object} structuredText - { schema, document, blocks?, links? }
 * @param {string} sourceLocale
 * @param {string} targetLocale
 * @param {Object} options
 * @param {Object} options.blockIdMap - Map of old block IDs → new block IDs (from server.js)
 * @returns {Object} - Translated structured text value with updated block references
 */
async function translateFullDast(structuredText, sourceLocale, targetLocale, options = {}) {
  if (!structuredText) return structuredText;

  const translated = deepClone(structuredText);
  const blockIdMap = options.blockIdMap || {};

  // 1. Translate document tree (spans in paragraphs, headings, etc.)
  if (translated.document && translated.document.children) {
    const blockCount = translated.document.children.filter(c => c.type === "block").length;
    const nonBlockCount = translated.document.children.length - blockCount;
    console.log(`   📄 DAST doc: ${nonBlockCount} translatable nodes, ${blockCount} block references`);

    // Replace block IDs with new ones from the map
    for (const child of translated.document.children) {
      if (child.type === "block" && child.item && blockIdMap[child.item]) {
        child.item = blockIdMap[child.item];
      }
    }

    await translateDastNode(translated.document, sourceLocale, targetLocale, options);
  }

  return translated;
}

/**
 * Translate a single block's translatable fields.
 * Determines block type from item_type and translates matching fields.
 */
async function translateBlock(block, sourceLocale, targetLocale, options) {
  if (!block || !block.item_type) return;

  // Get the block type API key — could be in different formats depending on CMA response
  const blockTypeId = block.item_type?.id || block.item_type;

  // Try to match by known block fields (since we might not have the API key directly)
  // We check which translatable fields exist on this block
  let fieldsToTranslate = null;

  // First try: match by item_type api_key if available
  if (block.item_type?.attributes?.api_key) {
    fieldsToTranslate = TRANSLATABLE_BLOCK_FIELDS[block.item_type.attributes.api_key];
  }

  // Fallback: auto-detect by checking which known fields exist on the block
  if (!fieldsToTranslate) {
    for (const [blockType, blockFields] of Object.entries(TRANSLATABLE_BLOCK_FIELDS)) {
      const hasMatchingFields = blockFields.some((f) => f in block);
      if (hasMatchingFields) {
        fieldsToTranslate = blockFields;
        console.log(`   🔧 Block ${block.id}: auto-detected as "${blockType}" (has fields: ${blockFields.filter(f => f in block).join(", ")})`);
        break;
      }
    }
  }

  if (!fieldsToTranslate) {
    // Not a translatable block type (video, gallery, apartment_slider, space, etc.)
    console.log(`   ⏭️  Block ${block.id}: no translatable fields found, copying as-is`);
    return;
  }

  for (const fieldKey of fieldsToTranslate) {
    const value = block[fieldKey];
    if (!value || typeof value !== "string" || !value.trim()) continue;

    try {
      console.log(`   📝 Block ${block.id} field "${fieldKey}": translating "${value.substring(0, 50)}..."`);
      block[fieldKey] = await translateSingleField(
        value, sourceLocale, targetLocale,
        { ...options, fieldName: `block.${fieldKey}` }
      );
    } catch (e) {
      console.error(`  ⚠️  Block ${block.id} field "${fieldKey}" translate failed: ${e.message}`);
    }
  }
}

/**
 * Recursively translate DAST document nodes in-place.
 */
async function translateDastNode(node, sourceLocale, targetLocale, options) {
  if (!node || !node.children) return;

  for (const child of node.children) {
    // Skip non-translatable nodes (blocks are handled separately via blocks array)
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
 */
async function translateSpanChildren(node, sourceLocale, targetLocale, options) {
  if (!node.children || node.children.length === 0) return;

  const spans = [];
  const nonSpanChildren = [];

  for (const child of node.children) {
    if (child.type === "span" && typeof child.value === "string" && child.value.trim()) {
      spans.push(child);
    } else if (child.type === "link" || child.type === "itemLink") {
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
    if (!span.value.trim()) continue;

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
 * @param {Object} structuredText - Source structured text { schema, document, blocks, links }
 * @param {string} sourceLocale
 * @param {string[]} targetLocales
 * @param {Object} options
 * @returns {Object} - { en: <translated structured text>, ru: <translated structured text> }
 */
async function translateStructuredTextField(structuredText, sourceLocale, targetLocales, options = {}) {
  const result = {};

  for (const targetLocale of targetLocales) {
    try {
      console.log(`   🌐 DAST → ${targetLocale}: starting translation...`);
      result[targetLocale] = await translateFullDast(structuredText, sourceLocale, targetLocale, options);
      console.log(`   ✅ DAST → ${targetLocale}: done`);
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
const SEO_TITLE_MAX = 60;
const SEO_DESCRIPTION_MAX = 160;

async function translateSeoField(seoObj, sourceLocale, targetLocales, options = {}) {
  if (!seoObj) return {};

  const result = {};

  for (const targetLocale of targetLocales) {
    const translated = { ...seoObj }; // copy image, twitter_card, etc.

    if (seoObj.title && typeof seoObj.title === "string" && seoObj.title.trim()) {
      try {
        translated.title = await translateSingleField(
          seoObj.title, sourceLocale, targetLocale,
          { ...options, fieldName: `seo_title (MAXIMUM ${SEO_TITLE_MAX} characters! Be concise.)` }
        );
        // Hard truncate if still too long
        if (translated.title && translated.title.length > SEO_TITLE_MAX) {
          console.log(`  ✂️  SEO title ${targetLocale}: ${translated.title.length} → truncated to ${SEO_TITLE_MAX}`);
          translated.title = translated.title.substring(0, SEO_TITLE_MAX - 1) + "…";
        }
      } catch (e) {
        console.error(`  ⚠️  SEO title translate to ${targetLocale} failed: ${e.message}`);
      }
    }

    if (seoObj.description && typeof seoObj.description === "string" && seoObj.description.trim()) {
      try {
        translated.description = await translateSingleField(
          seoObj.description, sourceLocale, targetLocale,
          { ...options, fieldName: `seo_description (MAXIMUM ${SEO_DESCRIPTION_MAX} characters! Be concise.)` }
        );
        // Hard truncate if still too long
        if (translated.description && translated.description.length > SEO_DESCRIPTION_MAX) {
          console.log(`  ✂️  SEO description ${targetLocale}: ${translated.description.length} → truncated to ${SEO_DESCRIPTION_MAX}`);
          translated.description = translated.description.substring(0, SEO_DESCRIPTION_MAX - 1) + "…";
        }
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
