require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { processAsset } = require("./alt-generator");
const { getDatocmsClient } = require("./datocms-client");
const { translateFields, translateStructuredTextField, translateSeoField } = require("./translator");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Serve DatoCMS plugin static files ──
app.use("/plugin", express.static(path.join(__dirname, "..", "datocms-plugin", "public")));

// ── Raw body for webhook signature verification ──
app.use(
  "/webhook",
  express.raw({ type: "application/json" }),
);

app.use(express.json({ limit: "5mb" }));

// ── CORS for DatoCMS plugin ──
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── Health check ──
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "datocms-alt-generator" });
});

// ── Webhook signature verification ──
function verifyWebhookSignature(req) {
  const secret = process.env.DATOCMS_WEBHOOK_SECRET;
  if (!secret) return true; // skip if no secret configured

  const signature = req.headers["x-datocms-signature"];
  if (!signature) return false;

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(req.body);
  const expected = hmac.digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}

// ── DatoCMS Webhook endpoint ──
app.post("/webhook", async (req, res) => {
  // Verify signature
  if (!verifyWebhookSignature(req)) {
    console.error("⚠️  Invalid webhook signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Parse body
  const payload = JSON.parse(req.body.toString());
  const eventType = req.headers["x-datocms-event"] || payload.event_type;
  const entityType = payload.entity_type || payload.entity?.type || "";

  console.log(`📥 Webhook received: event=${eventType}, entity_type=${entityType}`);

  // Accept both DatoCMS formats: "create" with entity_type "upload", or "upload.create"
  const isUploadEvent =
    eventType === "upload.create" ||
    eventType === "upload.update" ||
    ((eventType === "create" || eventType === "update") && entityType === "upload");

  if (!isUploadEvent) {
    console.log(`⏭️  Skipped: not an upload event (event=${eventType}, entity_type=${entityType})`);
    return res.json({ status: "skipped", reason: "not an upload event" });
  }

  const entity = payload.entity || payload.data;
  if (!entity || !entity.id) {
    console.error("❌ No entity or entity.id in payload:", JSON.stringify(payload).substring(0, 500));
    return res.status(400).json({ error: "No entity in payload" });
  }

  // Respond immediately, process in background
  res.json({ status: "processing", upload_id: entity.id });

  try {
    await processAsset(entity.id);
    console.log(`✅ ALT generated for asset ${entity.id}`);
  } catch (error) {
    console.error(`❌ Failed to process asset ${entity.id}:`, error.message);
  }
});

// ── Manual trigger: generate ALT for a single asset ──
app.post("/generate/:uploadId", async (req, res) => {
  const { uploadId } = req.params;
  const overwrite = req.query.overwrite === "true";

  try {
    const result = await processAsset(uploadId, { overwrite });
    res.json({ status: "ok", result });
  } catch (error) {
    console.error(`❌ Error processing ${uploadId}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── Bulk: generate ALTs for all assets missing them ──
app.post("/bulk-generate", async (req, res) => {
  const overwrite = req.query.overwrite === "true";
  const dryRun = req.query.dry_run === "true";

  res.json({ status: "started", message: "Bulk processing initiated. Check server logs for progress." });

  try {
    const client = getDatocmsClient();
    const assets = [];

    // Paginate through all uploads
    for await (const upload of client.uploads.listPagedIterator({ per_page: 100 })) {
      assets.push(upload);
    }

    console.log(`\n🔄 Bulk processing: ${assets.length} total assets found`);

    const locales = process.env.LOCALES.split(",").map((l) => l.trim());
    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (const asset of assets) {
      // Check if ALT already exists for all locales
      const hasAllAlts = locales.every(
        (locale) => asset.default_field_metadata?.[locale]?.alt,
      );

      if (hasAllAlts && !overwrite) {
        skipped++;
        continue;
      }

      if (dryRun) {
        console.log(`  [DRY RUN] Would process: ${asset.id} — ${asset.filename}`);
        processed++;
        continue;
      }

      try {
        await processAsset(asset.id, { overwrite });
        processed++;
        console.log(`  ✅ [${processed}] ${asset.filename}`);

        // Rate limit: wait 1s between requests to avoid API limits
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        errors++;
        console.error(`  ❌ ${asset.filename}: ${error.message}`);
      }
    }

    console.log(`\n📊 Bulk complete: ${processed} processed, ${skipped} skipped, ${errors} errors`);
  } catch (error) {
    console.error("❌ Bulk processing failed:", error.message);
  }
});

// ── Stats endpoint ──
app.get("/stats", async (req, res) => {
  try {
    const client = getDatocmsClient();
    const locales = process.env.LOCALES.split(",").map((l) => l.trim());

    let total = 0;
    let withAlts = 0;
    let withoutAlts = 0;

    for await (const upload of client.uploads.listPagedIterator({ per_page: 100 })) {
      total++;
      const hasAllAlts = locales.every(
        (locale) => upload.default_field_metadata?.[locale]?.alt,
      );
      if (hasAllAlts) withAlts++;
      else withoutAlts++;
    }

    res.json({ total, with_alts: withAlts, without_alts: withoutAlts, locales });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════════
// ── TRANSLATION ENDPOINTS ──
// ══════════════════════════════════════════════

/**
 * Translate fields from source locale to target locales.
 * Used by the DatoCMS sidebar plugin.
 *
 * POST /translate
 * Body: { fields: { title: "...", description: "..." }, sourceLocale: "pl-PL", targetLocales: ["en", "ru"], modelName: "apartment" }
 * Returns: { en: { title: "...", description: "..." }, ru: { ... } }
 */
app.post("/translate", async (req, res) => {
  const { fields, sourceLocale, targetLocales, modelName } = req.body;

  if (!fields || !sourceLocale || !targetLocales) {
    return res.status(400).json({ error: "Missing required fields: fields, sourceLocale, targetLocales" });
  }

  try {
    console.log(`🌐 Translating ${Object.keys(fields).length} fields from ${sourceLocale} to ${targetLocales.join(", ")}${modelName ? ` (model: ${modelName})` : ""}`);
    const translations = await translateFields(fields, sourceLocale, targetLocales, { modelName });
    console.log(`✅ Translation complete`);
    res.json(translations);
  } catch (error) {
    console.error(`❌ Translation failed:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Translate a single record by ID and save directly to DatoCMS.
 * Used by the sidebar plugin — most reliable approach.
 *
 * POST /translate-record
 * Body: { recordId: "abc123", overwrite: false }
 */
app.post("/translate-record", async (req, res) => {
  const { recordId, overwrite } = req.body;

  if (!recordId) {
    return res.status(400).json({ error: "Missing recordId" });
  }

  const locales = process.env.LOCALES.split(",").map((l) => l.trim());
  const sourceLocale = locales[0];
  const targetLocales = locales.slice(1);

  try {
    const client = getDatocmsClient();

    // Fetch the record
    const record = await client.items.find(recordId);
    if (!record) {
      return res.status(404).json({ error: "Record not found" });
    }

    // Get the model's fields
    const itemTypeId = record.item_type ? record.item_type.id : record.relationships?.item_type?.data?.id;
    if (!itemTypeId) {
      return res.status(400).json({ error: "Cannot determine item type" });
    }

    const fields = await client.fields.list(itemTypeId);

    // Separate field types
    const localizedTextFields = fields.filter(
      (f) => f.localized && ["string", "text"].includes(f.field_type),
    );
    const localizedDastFields = fields.filter(
      (f) => f.localized && f.field_type === "structured_text",
    );
    const localizedSeoFields = fields.filter(
      (f) => f.localized && f.field_type === "seo",
    );

    console.log(`📋 Fields found — text: ${localizedTextFields.length}, DAST: ${localizedDastFields.length}, SEO: ${localizedSeoFields.length}`);
    console.log(`   DAST fields: ${localizedDastFields.map(f => f.api_key).join(", ") || "none"}`);
    console.log(`   SEO fields: ${localizedSeoFields.map(f => f.api_key).join(", ") || "none"}`);

    const translatableCount = localizedTextFields.length + localizedDastFields.length + localizedSeoFields.length;
    if (translatableCount === 0) {
      return res.json({ status: "skipped", message: "No localized translatable fields in this model" });
    }

    const modelInfo = await client.itemTypes.find(itemTypeId);
    const modelName = modelInfo.api_key;

    // ── Extract source text fields ──
    const sourceFields = {};
    for (const field of localizedTextFields) {
      const fieldValue = record[field.api_key];
      if (!fieldValue || typeof fieldValue !== "object") continue;

      const sourceText = fieldValue[sourceLocale];
      if (!sourceText || typeof sourceText !== "string" || !sourceText.trim()) continue;

      const targetsMissing = targetLocales.some((l) => {
        const val = fieldValue[l];
        return !val || (typeof val === "string" && !val.trim());
      });

      if (targetsMissing || overwrite) {
        sourceFields[field.api_key] = sourceText;
      }
    }

    // ── Extract source DAST fields ──
    const sourceDastFields = {};
    for (const field of localizedDastFields) {
      const fieldValue = record[field.api_key];
      console.log(`   🔍 DAST field "${field.api_key}": fieldValue type=${typeof fieldValue}, isNull=${fieldValue === null}`);
      if (!fieldValue || typeof fieldValue !== "object") continue;

      const sourceDast = fieldValue[sourceLocale];
      console.log(`   🔍 DAST "${field.api_key}" sourceLocale=${sourceLocale}: type=${typeof sourceDast}, hasChildren=${sourceDast?.children?.length || 0}, keys=${sourceDast ? Object.keys(sourceDast).join(",") : "null"}`);
      if (!sourceDast || !sourceDast.children || sourceDast.children.length === 0) continue;

      const targetsMissing = targetLocales.some((l) => {
        const val = fieldValue[l];
        return !val || !val.children || val.children.length === 0;
      });

      if (targetsMissing || overwrite) {
        sourceDastFields[field.api_key] = sourceDast;
      }
    }

    // ── Extract source SEO fields ──
    const sourceSeoFields = {};
    for (const field of localizedSeoFields) {
      const fieldValue = record[field.api_key];
      console.log(`   🔍 SEO field "${field.api_key}": fieldValue type=${typeof fieldValue}, isNull=${fieldValue === null}`);
      if (!fieldValue || typeof fieldValue !== "object") continue;

      const sourceSeo = fieldValue[sourceLocale];
      console.log(`   🔍 SEO "${field.api_key}" sourceLocale=${sourceLocale}: ${sourceSeo ? JSON.stringify(sourceSeo).substring(0, 200) : "null"}`);
      if (!sourceSeo) continue;

      // Check if there's anything to translate (title or description)
      const hasContent = (sourceSeo.title && sourceSeo.title.trim()) || (sourceSeo.description && sourceSeo.description.trim());
      if (!hasContent) continue;

      const targetsMissing = targetLocales.some((l) => {
        const val = fieldValue[l];
        return !val || (!val.title && !val.description);
      });

      if (targetsMissing || overwrite) {
        sourceSeoFields[field.api_key] = sourceSeo;
      }
    }

    const totalToTranslate = Object.keys(sourceFields).length + Object.keys(sourceDastFields).length + Object.keys(sourceSeoFields).length;

    if (totalToTranslate === 0) {
      return res.json({ status: "skipped", message: "All fields already translated", translated: 0 });
    }

    console.log(`🌐 Translating record ${recordId} (${modelName}): ${Object.keys(sourceFields).length} text, ${Object.keys(sourceDastFields).length} DAST, ${Object.keys(sourceSeoFields).length} SEO`);

    // ── Translate text fields ──
    const translations = Object.keys(sourceFields).length > 0
      ? await translateFields(sourceFields, sourceLocale, targetLocales, { modelName })
      : {};

    // ── Translate DAST fields ──
    const dastTranslations = {}; // { fieldApiKey: { en: <DAST>, ru: <DAST> } }
    for (const [fieldApiKey, sourceDast] of Object.entries(sourceDastFields)) {
      try {
        dastTranslations[fieldApiKey] = await translateStructuredTextField(
          sourceDast, sourceLocale, targetLocales, { modelName, fieldName: fieldApiKey }
        );
      } catch (e) {
        console.error(`  ⚠️  DAST field ${fieldApiKey} translation failed: ${e.message}`);
      }
    }

    // ── Translate SEO fields ──
    const seoTranslations = {}; // { fieldApiKey: { en: { title, description, ... }, ru: { ... } } }
    for (const [fieldApiKey, sourceSeo] of Object.entries(sourceSeoFields)) {
      try {
        seoTranslations[fieldApiKey] = await translateSeoField(
          sourceSeo, sourceLocale, targetLocales, { modelName, fieldName: fieldApiKey }
        );
      } catch (e) {
        console.error(`  ⚠️  SEO field ${fieldApiKey} translation failed: ${e.message}`);
      }
    }

    // ── Build update payload — MUST include ALL localized fields when adding new locales ──
    const allLocalizedFields = fields.filter((f) => f.localized);
    const updatePayload = {};

    for (const field of allLocalizedFields) {
      const currentValue = record[field.api_key];
      const apiKey = field.api_key;

      // ── Text fields we translated ──
      if (sourceFields[apiKey]) {
        const updatedValue = { ...(currentValue || {}) };
        for (const locale of targetLocales) {
          if (translations[locale] && translations[locale][apiKey]) {
            if (!overwrite && updatedValue[locale] && String(updatedValue[locale]).trim()) continue;
            updatedValue[locale] = translations[locale][apiKey];
          } else if (!(locale in updatedValue)) {
            updatedValue[locale] = null;
          }
        }
        updatePayload[apiKey] = updatedValue;
        continue;
      }

      // ── DAST fields we translated ──
      if (sourceDastFields[apiKey] && dastTranslations[apiKey]) {
        const updatedValue = { ...(currentValue || {}) };
        for (const locale of targetLocales) {
          if (dastTranslations[apiKey][locale]) {
            if (!overwrite && updatedValue[locale] && updatedValue[locale].children && updatedValue[locale].children.length > 0) continue;
            updatedValue[locale] = dastTranslations[apiKey][locale];
          } else if (!(locale in updatedValue)) {
            updatedValue[locale] = null;
          }
        }
        updatePayload[apiKey] = updatedValue;
        continue;
      }

      // ── SEO fields we translated ──
      if (sourceSeoFields[apiKey] && seoTranslations[apiKey]) {
        const updatedValue = { ...(currentValue || {}) };
        for (const locale of targetLocales) {
          if (seoTranslations[apiKey][locale]) {
            if (!overwrite && updatedValue[locale] && (updatedValue[locale].title || updatedValue[locale].description)) continue;
            updatedValue[locale] = seoTranslations[apiKey][locale];
          } else if (!(locale in updatedValue)) {
            updatedValue[locale] = null;
          }
        }
        updatePayload[apiKey] = updatedValue;
        continue;
      }

      // ── Non-translated fields: just ensure all locales exist ──
      if (currentValue && typeof currentValue === "object") {
        const updated = { ...currentValue };
        for (const locale of targetLocales) {
          if (!(locale in updated)) {
            updated[locale] = null;
          }
        }
        updatePayload[apiKey] = updated;
      }
    }

    // Save to DatoCMS
    await client.items.update(recordId, updatePayload);

    const translatedCount = totalToTranslate;
    console.log(`✅ Record ${recordId}: ${translatedCount} fields translated and saved`);

    res.json({
      status: "ok",
      translated: translatedCount,
      fields: Object.keys(updatePayload),
      message: `Przetłumaczono ${translatedCount} pól i zapisano do DatoCMS`,
    });
  } catch (error) {
    console.error(`❌ translate-record ${recordId}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Bulk translate all records of a specific model (or all models).
 *
 * POST /bulk-translate
 * Query params:
 *   ?model=apartment        — only translate this model (item type API key)
 *   ?overwrite=true         — overwrite existing translations
 *   ?dry_run=true           — preview without changes
 */
app.post("/bulk-translate", async (req, res) => {
  const modelFilter = req.query.model || null;
  const overwrite = req.query.overwrite === "true";
  const dryRun = req.query.dry_run === "true";

  const locales = process.env.LOCALES.split(",").map((l) => l.trim());
  const sourceLocale = locales[0]; // pl-PL
  const targetLocales = locales.slice(1); // [en, ru]

  res.json({ status: "started", message: "Bulk translation initiated. Check server logs for progress." });

  try {
    const client = getDatocmsClient();

    // Get all item types (models)
    const itemTypes = await client.itemTypes.list();
    const modelsToProcess = modelFilter
      ? itemTypes.filter((m) => m.api_key === modelFilter)
      : itemTypes;

    console.log(`\n🌐 Bulk translate: ${modelsToProcess.length} models, source=${sourceLocale}, targets=${targetLocales.join(",")}`);

    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const model of modelsToProcess) {
      // Get fields for this model
      const fields = await client.fields.list(model.id);

      // Find localized translatable fields
      const textFields = fields.filter(
        (f) => f.localized && ["string", "text"].includes(f.field_type),
      );
      const dastFields = fields.filter(
        (f) => f.localized && f.field_type === "structured_text",
      );
      const seoFields = fields.filter(
        (f) => f.localized && f.field_type === "seo",
      );

      const translatableCount = textFields.length + dastFields.length + seoFields.length;
      if (translatableCount === 0) {
        console.log(`  ⏭️  ${model.api_key}: no localized translatable fields`);
        continue;
      }

      console.log(`\n📋 Model: ${model.api_key} (${textFields.length} text, ${dastFields.length} DAST, ${seoFields.length} SEO)`);

      // Get all records for this model
      const records = [];
      for await (const record of client.items.listPagedIterator({
        filter: { type: model.api_key },
        per_page: 100,
        nested: true,
      })) {
        records.push(record);
      }

      console.log(`   ${records.length} records found`);

      for (const record of records) {
        // Extract source values
        const sourceTextFields = {};
        const sourceDastFields = {};
        const sourceSeoFields = {};

        for (const field of textFields) {
          const fieldValue = record[field.api_key];
          if (!fieldValue || typeof fieldValue !== "object") continue;
          const sourceText = fieldValue[sourceLocale];
          if (!sourceText || typeof sourceText !== "string" || !sourceText.trim()) continue;
          const targetsMissing = targetLocales.some((l) => {
            const val = fieldValue[l];
            return !val || (typeof val === "string" && !val.trim());
          });
          if (targetsMissing || overwrite) sourceTextFields[field.api_key] = sourceText;
        }

        for (const field of dastFields) {
          const fieldValue = record[field.api_key];
          if (!fieldValue || typeof fieldValue !== "object") continue;
          const sourceDast = fieldValue[sourceLocale];
          if (!sourceDast || !sourceDast.children || sourceDast.children.length === 0) continue;
          const targetsMissing = targetLocales.some((l) => {
            const val = fieldValue[l];
            return !val || !val.children || val.children.length === 0;
          });
          if (targetsMissing || overwrite) sourceDastFields[field.api_key] = sourceDast;
        }

        for (const field of seoFields) {
          const fieldValue = record[field.api_key];
          if (!fieldValue || typeof fieldValue !== "object") continue;
          const sourceSeo = fieldValue[sourceLocale];
          if (!sourceSeo) continue;
          const hasContent = (sourceSeo.title && sourceSeo.title.trim()) || (sourceSeo.description && sourceSeo.description.trim());
          if (!hasContent) continue;
          const targetsMissing = targetLocales.some((l) => {
            const val = fieldValue[l];
            return !val || (!val.title && !val.description);
          });
          if (targetsMissing || overwrite) sourceSeoFields[field.api_key] = sourceSeo;
        }

        const totalFields = Object.keys(sourceTextFields).length + Object.keys(sourceDastFields).length + Object.keys(sourceSeoFields).length;
        if (totalFields === 0) {
          totalSkipped++;
          continue;
        }

        if (dryRun) {
          console.log(`   [DRY RUN] Would translate record ${record.id}: ${[...Object.keys(sourceTextFields), ...Object.keys(sourceDastFields), ...Object.keys(sourceSeoFields)].join(", ")}`);
          totalProcessed++;
          continue;
        }

        try {
          // Translate text fields
          const translations = Object.keys(sourceTextFields).length > 0
            ? await translateFields(sourceTextFields, sourceLocale, targetLocales, { modelName: model.api_key })
            : {};

          // Translate DAST fields
          const dastTranslations = {};
          for (const [apiKey, sourceDast] of Object.entries(sourceDastFields)) {
            try {
              dastTranslations[apiKey] = await translateStructuredTextField(
                sourceDast, sourceLocale, targetLocales, { modelName: model.api_key, fieldName: apiKey }
              );
            } catch (e) {
              console.error(`   ⚠️  DAST ${apiKey}: ${e.message}`);
            }
          }

          // Translate SEO fields
          const seoTranslations = {};
          for (const [apiKey, sourceSeo] of Object.entries(sourceSeoFields)) {
            try {
              seoTranslations[apiKey] = await translateSeoField(
                sourceSeo, sourceLocale, targetLocales, { modelName: model.api_key, fieldName: apiKey }
              );
            } catch (e) {
              console.error(`   ⚠️  SEO ${apiKey}: ${e.message}`);
            }
          }

          // Build update payload — include ALL localized fields for new locale support
          const allLocalized = fields.filter((f) => f.localized);
          const updatePayload = {};

          for (const field of allLocalized) {
            const currentValue = record[field.api_key];
            const apiKey = field.api_key;

            if (sourceTextFields[apiKey]) {
              const updatedValue = { ...(currentValue || {}) };
              for (const locale of targetLocales) {
                if (translations[locale] && translations[locale][apiKey]) {
                  if (!overwrite && updatedValue[locale] && String(updatedValue[locale]).trim()) continue;
                  updatedValue[locale] = translations[locale][apiKey];
                } else if (!(locale in updatedValue)) {
                  updatedValue[locale] = null;
                }
              }
              updatePayload[apiKey] = updatedValue;
              continue;
            }

            if (sourceDastFields[apiKey] && dastTranslations[apiKey]) {
              const updatedValue = { ...(currentValue || {}) };
              for (const locale of targetLocales) {
                if (dastTranslations[apiKey][locale]) {
                  if (!overwrite && updatedValue[locale] && updatedValue[locale].children && updatedValue[locale].children.length > 0) continue;
                  updatedValue[locale] = dastTranslations[apiKey][locale];
                } else if (!(locale in updatedValue)) {
                  updatedValue[locale] = null;
                }
              }
              updatePayload[apiKey] = updatedValue;
              continue;
            }

            if (sourceSeoFields[apiKey] && seoTranslations[apiKey]) {
              const updatedValue = { ...(currentValue || {}) };
              for (const locale of targetLocales) {
                if (seoTranslations[apiKey][locale]) {
                  if (!overwrite && updatedValue[locale] && (updatedValue[locale].title || updatedValue[locale].description)) continue;
                  updatedValue[locale] = seoTranslations[apiKey][locale];
                } else if (!(locale in updatedValue)) {
                  updatedValue[locale] = null;
                }
              }
              updatePayload[apiKey] = updatedValue;
              continue;
            }

            // Non-translated field: ensure all locales exist
            if (currentValue && typeof currentValue === "object") {
              const updated = { ...currentValue };
              for (const locale of targetLocales) {
                if (!(locale in updated)) updated[locale] = null;
              }
              updatePayload[apiKey] = updated;
            }
          }

          await client.items.update(record.id, updatePayload);
          totalProcessed++;
          console.log(`   ✅ [${totalProcessed}] Record ${record.id}`);

          // Rate limit
          await new Promise((resolve) => setTimeout(resolve, 1500));
        } catch (error) {
          totalErrors++;
          console.error(`   ❌ Record ${record.id}: ${error.message}`);
        }
      }
    }

    console.log(`\n📊 Bulk translate complete: ${totalProcessed} translated, ${totalSkipped} skipped, ${totalErrors} errors`);
  } catch (error) {
    console.error("❌ Bulk translation failed:", error.message);
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 DatoCMS ALT Generator + Translator running on port ${PORT}`);
  console.log(`   Locales: ${process.env.LOCALES}`);
  console.log(`   Context: ${process.env.BUSINESS_CONTEXT}`);
  console.log(`\n📡 Endpoints:`);
  console.log(`   POST /webhook              — DatoCMS webhook (ALT gen)`);
  console.log(`   POST /generate/:id         — Single asset ALT`);
  console.log(`   POST /bulk-generate        — Bulk ALT generation`);
  console.log(`   GET  /stats                — ALT coverage stats`);
  console.log(`   POST /translate            — Translate fields (for sidebar plugin)`);
  console.log(`   POST /bulk-translate       — Bulk translate records`);
  console.log(`   GET  /health               — Health check\n`);
});
