require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const { processAsset } = require("./alt-generator");
const { getDatocmsClient } = require("./datocms-client");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Raw body for webhook signature verification ──
app.use(
  "/webhook",
  express.raw({ type: "application/json" }),
);

app.use(express.json());

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

  console.log(`📥 Webhook received: ${eventType}`);

  // Only process upload events
  if (eventType !== "upload.create" && eventType !== "upload.update") {
    return res.json({ status: "skipped", reason: "not an upload event" });
  }

  const entity = payload.entity || payload.data;
  if (!entity) {
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

app.listen(PORT, () => {
  console.log(`\n🚀 DatoCMS ALT Generator running on port ${PORT}`);
  console.log(`   Locales: ${process.env.LOCALES}`);
  console.log(`   Context: ${process.env.BUSINESS_CONTEXT}`);
  console.log(`\n📡 Endpoints:`);
  console.log(`   POST /webhook              — DatoCMS webhook`);
  console.log(`   POST /generate/:id         — Single asset`);
  console.log(`   POST /bulk-generate        — All assets`);
  console.log(`   GET  /stats                — Coverage stats`);
  console.log(`   GET  /health               — Health check\n`);
});
