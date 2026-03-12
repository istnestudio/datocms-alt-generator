#!/usr/bin/env node

/**
 * Standalone bulk processing script
 * Usage:
 *   node src/bulk-process.js                  — Process assets with missing ALTs
 *   node src/bulk-process.js --overwrite      — Regenerate all ALTs
 *   node src/bulk-process.js --dry-run        — Preview what would be processed
 *   node src/bulk-process.js --stats          — Show ALT coverage statistics
 */

require("dotenv").config();
const { getDatocmsClient } = require("./datocms-client");
const { processAsset } = require("./alt-generator");
const { isSupportedMedia } = require("./video-handler");

const args = process.argv.slice(2);
const overwrite = args.includes("--overwrite");
const dryRun = args.includes("--dry-run");
const statsOnly = args.includes("--stats");

async function main() {
  const client = getDatocmsClient();
  const locales = process.env.LOCALES.split(",").map((l) => l.trim());

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║   DatoCMS ALT Text Bulk Generator            ║");
  console.log("╚══════════════════════════════════════════════╝\n");
  console.log(`  Locales:    ${locales.join(", ")}`);
  console.log(`  Overwrite:  ${overwrite}`);
  console.log(`  Dry run:    ${dryRun}`);
  console.log("");

  // Collect all assets
  console.log("📦 Fetching all assets from DatoCMS...");
  const assets = [];

  for await (const upload of client.uploads.listPagedIterator({ per_page: 100 })) {
    assets.push(upload);
  }

  console.log(`   Found ${assets.length} total assets\n`);

  // Filter to supported media types
  const supportedAssets = assets.filter((a) => isSupportedMedia(a.mime_type));
  const unsupported = assets.length - supportedAssets.length;

  console.log(`   Supported media: ${supportedAssets.length}`);
  console.log(`   Unsupported (PDFs, docs, etc.): ${unsupported}\n`);

  // Categorize
  const needsProcessing = [];
  const alreadyComplete = [];

  for (const asset of supportedAssets) {
    const metadata = asset.default_field_metadata || {};
    const hasAllAlts = locales.every((locale) => metadata[locale]?.alt);

    if (hasAllAlts && !overwrite) {
      alreadyComplete.push(asset);
    } else {
      needsProcessing.push(asset);
    }
  }

  // Stats
  console.log("📊 ALT Text Coverage:");
  console.log(`   ✅ Complete (all ${locales.length} locales): ${alreadyComplete.length}`);
  console.log(`   ❌ Missing/incomplete:                      ${needsProcessing.length}`);
  console.log(`   📈 Coverage: ${((alreadyComplete.length / supportedAssets.length) * 100).toFixed(1)}%\n`);

  // Per-locale breakdown
  console.log("📋 Per-locale breakdown:");
  for (const locale of locales) {
    const withAlt = supportedAssets.filter(
      (a) => a.default_field_metadata?.[locale]?.alt,
    ).length;
    const pct = ((withAlt / supportedAssets.length) * 100).toFixed(1);
    console.log(`   ${locale}: ${withAlt}/${supportedAssets.length} (${pct}%)`);
  }
  console.log("");

  if (statsOnly) {
    console.log("ℹ️  Stats only mode. Exiting.\n");
    return;
  }

  if (needsProcessing.length === 0) {
    console.log("🎉 All assets already have complete ALT texts!\n");
    return;
  }

  if (dryRun) {
    console.log("🔍 DRY RUN — Assets that would be processed:\n");
    for (const asset of needsProcessing) {
      const missingLocales = locales.filter(
        (l) => !asset.default_field_metadata?.[l]?.alt,
      );
      console.log(`   📄 ${asset.id} | ${asset.filename} | missing: ${missingLocales.join(", ")}`);
    }
    console.log(`\n   Total: ${needsProcessing.length} assets would be processed.\n`);
    return;
  }

  // Process
  console.log(`\n🚀 Processing ${needsProcessing.length} assets...\n`);

  let processed = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < needsProcessing.length; i++) {
    const asset = needsProcessing[i];
    const progress = `[${i + 1}/${needsProcessing.length}]`;

    try {
      const result = await processAsset(asset.id, { overwrite });

      if (result.skipped) {
        console.log(`   ⏭️  ${progress} ${asset.filename} — skipped: ${result.reason}`);
      } else {
        processed++;
        console.log(`   ✅ ${progress} ${asset.filename}`);
        for (const [locale, alt] of Object.entries(result.altTexts)) {
          console.log(`      ${locale}: "${alt}"`);
        }
      }

      // Rate limiting: 1.5s between API calls
      if (i < needsProcessing.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } catch (error) {
      errors++;
      console.error(`   ❌ ${progress} ${asset.filename}: ${error.message}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║   BULK PROCESSING COMPLETE                   ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`   ✅ Processed:  ${processed}`);
  console.log(`   ❌ Errors:     ${errors}`);
  console.log(`   ⏱️  Time:       ${elapsed}s`);
  console.log("");
}

main().catch((err) => {
  console.error("\n💥 Fatal error:", err.message);
  process.exit(1);
});
