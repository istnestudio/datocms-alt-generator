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
 * Known text fields in blocks that should be translated.
 * These are field API keys commonly used in DatoCMS block models.
 */
const KNOWN_TRANSLATABLE_BLOCK_FIELDS = [
  "title", "description", "link_name", "text", "label", "content",
  "heading", "subtitle", "button_text", "cta_text", "name",
  "alt_text", "caption", "placeholder", "tooltip",
];

/**
 * Field name patterns that should NOT be translated (URLs, IDs, technical values).
 */
const NON_TRANSLATABLE_PATTERNS = [
  /^(id|url|href|link|src|slug|api_key|css_class|icon|color|type|target|rel)$/i,
  /_id$/i,
  /_url$/i,
  /_href$/i,
];

/**
 * Translate a full DatoCMS Structured Text value.
 *
 * Handles:
 * 1. Block nodes — clones each block WITHOUT its ID so the API creates new per-locale
 *    block records. Translates text fields inside block attributes.
 * 2. Document tree — translates text spans in paragraphs, headings, lists, etc.
 *
 * IMPORTANT: The record must be fetched with `nested: true` so that block nodes
 * contain full JSON:API objects (not just string IDs).
 *
 * @param {Object} structuredText - { schema, document, blocks?, links? }
 * @param {string} sourceLocale
 * @param {string} targetLocale
 * @param {Object} options
 * @returns {Object} - Translated structured text with new block records
 */
async function translateFullDast(structuredText, sourceLocale, targetLocale, options = {}) {
  if (!structuredText) return structuredText;

  const translated = deepClone(structuredText);

  if (translated.document && translated.document.children) {
    // Step 1: Process blocks — clone without ID to create new per-locale block records
    const blockCount = await processBlockNodes(translated.document, sourceLocale, targetLocale, options);

    // Step 2: Translate text nodes (paragraphs, headings, links, etc.)
    await translateDastNode(translated.document, sourceLocale, targetLocale, options);

    // Remove blocks/links arrays — not needed when blocks are embedded as full objects
    delete translated.blocks;
    delete translated.links;

    const textNodeCount = translated.document.children.filter(c => c.type !== "block" && c.type !== "inlineItem").length;
    console.log(`   📄 DAST → ${targetLocale}: ${textNodeCount} text nodes translated, ${blockCount} blocks cloned`);
  }

  return translated;
}

/**
 * Recursively process block and inlineItem nodes in DAST.
 *
 * For nested blocks (full JSON:API objects from `nested: true` fetch):
 * - Clones the block object
 * - Removes the `id` so the DatoCMS API creates a NEW block record for this locale
 * - Translates known text fields in the block's attributes
 *
 * For non-nested blocks (string IDs):
 * - Strips them since block IDs are per-locale and won't work in the target locale
 *
 * @returns {number} Count of blocks processed
 */
async function processBlockNodes(node, sourceLocale, targetLocale, options) {
  if (!node || !node.children) return 0;
  let count = 0;

  for (const child of node.children) {
    if ((child.type === "block" || child.type === "inlineItem") && child.item) {
      if (typeof child.item === "object" && child.item.type === "item") {
        // ── Nested block (full JSON:API object) ──
        // Clone and remove ID → API will create a new block record for this locale
        const newBlock = deepClone(child.item);
        delete newBlock.id;
        delete newBlock.meta;

        // Translate text fields in block attributes
        if (newBlock.attributes) {
          const translatableKeys = detectTranslatableAttributes(newBlock.attributes);
          for (const fieldKey of translatableKeys) {
            const value = newBlock.attributes[fieldKey];
            try {
              console.log(`   📝 Block field "${fieldKey}": translating "${String(value).substring(0, 60)}..."`);
              newBlock.attributes[fieldKey] = await translateSingleField(
                value, sourceLocale, targetLocale,
                { ...options, fieldName: `block.${fieldKey}` }
              );
            } catch (e) {
              console.error(`  ⚠️  Block field "${fieldKey}" translate failed: ${e.message}`);
            }
          }
        }

        child.item = newBlock;
        count++;
      } else if (typeof child.item === "string") {
        // ── Non-nested (string ID) — cannot create new block without data ──
        console.log(`   ⚠️  Block "${child.item}": string ID (not nested) — stripping. Fetch record with nested:true to preserve blocks.`);
        child.type = "__stripped_block";
      }
    }

    // Recurse into container nodes (list, listItem, blockquote, etc.)
    if (child.children) {
      count += await processBlockNodes(child, sourceLocale, targetLocale, options);
    }
  }

  // Remove stripped blocks
  if (node.children) {
    node.children = node.children.filter(c => c.type !== "__stripped_block");
  }

  return count;
}

/**
 * Detect which attributes of a block are translatable text fields.
 * Returns array of attribute keys that should be translated.
 */
function detectTranslatableAttributes(attributes) {
  return Object.keys(attributes).filter(key => {
    const value = attributes[key];
    // Only translate non-empty strings
    if (!value || typeof value !== "string" || !value.trim()) return false;
    // Skip non-translatable patterns (URLs, IDs, technical values)
    if (NON_TRANSLATABLE_PATTERNS.some(p => p.test(key))) return false;
    // Include known text fields
    if (KNOWN_TRANSLATABLE_BLOCK_FIELDS.includes(key)) return true;
    // Unknown fields — skip (safer default)
    return false;
  });
}

/**
 * Recursively translate DAST document nodes in-place.
 */
async function translateDastNode(node, sourceLocale, targetLocale, options) {
  if (!node || !node.children) return;

  for (const child of node.children) {
    // Skip blocks (handled by processBlockNodes), inline items, and thematic breaks
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
// ── Modular Content translation ──
// ══════════════════════════════════════════════

/**
 * Translate a DatoCMS Modular Content field (field_type: "rich_text").
 *
 * Modular content is an array of block records. With `nested: true`,
 * each block is a full JSON:API object:
 *   { id: "...", type: "item", attributes: {...}, relationships: { item_type: {...} }, meta: {...} }
 *
 * For target locales, we clone each block WITHOUT its `id` (so the API creates
 * new per-locale block records) and translate known text fields.
 *
 * @param {Array} blocks - Source array of block objects (from nested fetch)
 * @param {string} sourceLocale
 * @param {string[]} targetLocales
 * @param {Object} options
 * @returns {Object} - { en: [translatedBlocks], ru: [translatedBlocks] }
 */
async function translateModularContentField(blocks, sourceLocale, targetLocales, options = {}) {
  if (!blocks || !Array.isArray(blocks) || blocks.length === 0) return {};

  const result = {};

  for (const targetLocale of targetLocales) {
    try {
      const translatedBlocks = [];

      for (const block of blocks) {
        if (typeof block === "object" && block.type === "item") {
          // ── Nested block (full JSON:API object) ──
          const newBlock = deepClone(block);
          delete newBlock.id;   // Remove ID → API creates new block record
          delete newBlock.meta; // Remove metadata

          // Translate text fields in block attributes
          if (newBlock.attributes) {
            const translatableKeys = detectTranslatableAttributes(newBlock.attributes);
            for (const fieldKey of translatableKeys) {
              const value = newBlock.attributes[fieldKey];
              try {
                console.log(`   📝 MC block "${fieldKey}": translating "${String(value).substring(0, 60)}..." → ${targetLocale}`);
                newBlock.attributes[fieldKey] = await translateSingleField(
                  value, sourceLocale, targetLocale,
                  { ...options, fieldName: `modular_content.${fieldKey}` }
                );
              } catch (e) {
                console.error(`  ⚠️  MC block field "${fieldKey}" translate failed: ${e.message}`);
              }
            }
          }

          translatedBlocks.push(newBlock);
        } else if (typeof block === "string") {
          // Non-nested (string ID) — can't clone without data, skip
          console.log(`   ⚠️  MC block "${block}": string ID (not nested) — skipping. Fetch with nested:true.`);
        }
      }

      console.log(`   ✅ MC → ${targetLocale}: ${translatedBlocks.length} blocks cloned`);
      result[targetLocale] = translatedBlocks;
    } catch (error) {
      console.error(`  ⚠️  MC translation to ${targetLocale} failed: ${error.message}`);
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
  translateModularContentField,
  translateSeoField,
};
