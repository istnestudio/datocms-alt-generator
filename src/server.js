require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const { processAsset } = require("./alt-generator");
const { getDatocmsClient } = require("./datocms-client");
const { translateFields } = require("./translator");

const app = express();
const PORT = process.env.PORT || 3000;

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

      // Find localized text/string fields
      const localizedFields = fields.filter(
        (f) => f.localized && ["string", "text", "seo", "structured_text"].includes(f.field_type),
      );

      if (localizedFields.length === 0) {
        console.log(`  ⏭️  ${model.api_key}: no localized text fields`);
        continue;
      }

      console.log(`\n📋 Model: ${model.api_key} (${localizedFields.length} localized fields)`);

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
        // Extract source locale values for localized fields
        const sourceFields = {};
        let needsTranslation = false;

        for (const field of localizedFields) {
          const fieldValue = record[field.api_key];
          if (!fieldValue || typeof fieldValue !== "object") continue;

          const sourceText = fieldValue[sourceLocale];
          if (!sourceText || (typeof sourceText === "string" && !sourceText.trim())) continue;

          // Check if target locales need translation
          const targetsMissing = targetLocales.some((l) => {
            const val = fieldValue[l];
            return !val || (typeof val === "string" && !val.trim());
          });

          if (targetsMissing || overwrite) {
            // Only translate string/text fields (skip structured_text and seo for now in bulk)
            if (typeof sourceText === "string") {
              sourceFields[field.api_key] = sourceText;
              needsTranslation = true;
            }
          }
        }

        if (!needsTranslation) {
          totalSkipped++;
          continue;
        }

        if (dryRun) {
          console.log(`   [DRY RUN] Would translate record ${record.id}: ${Object.keys(sourceFields).join(", ")}`);
          totalProcessed++;
          continue;
        }

        try {
          const translations = await translateFields(sourceFields, sourceLocale, targetLocales, { modelName: model.api_key });

          // Build update payload
          const updatePayload = {};
          for (const field of localizedFields) {
            if (!sourceFields[field.api_key]) continue;

            const currentValue = record[field.api_key] || {};
            const updatedValue = { ...currentValue };

            for (const locale of targetLocales) {
              if (translations[locale] && translations[locale][field.api_key]) {
                updatedValue[locale] = translations[locale][field.api_key];
              }
            }

            updatePayload[field.api_key] = updatedValue;
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
