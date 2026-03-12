const { getUpload, updateUploadAlt } = require("./datocms-client");
const { generateAltTexts } = require("./claude-vision");
const { extractVideoThumbnail, isVideo, isSupportedMedia } = require("./video-handler");
const Anthropic = require("@anthropic-ai/sdk");

/**
 * Main processing function: fetches an asset, generates ALTs, and updates DatoCMS
 *
 * @param {string} uploadId - DatoCMS upload/asset ID
 * @param {Object} options
 * @param {boolean} options.overwrite - Overwrite existing ALT texts (default: false)
 * @returns {Object} - Generated ALT texts
 */
async function processAsset(uploadId, options = {}) {
  const { overwrite = false } = options;
  const locales = process.env.LOCALES.split(",").map((l) => l.trim());

  // 1. Fetch the asset from DatoCMS
  const upload = await getUpload(uploadId);

  if (!upload) {
    throw new Error(`Upload ${uploadId} not found`);
  }

  // 2. Check mime type
  const mimeType = upload.mime_type;
  if (!isSupportedMedia(mimeType)) {
    console.log(`⏭️  Skipping ${upload.filename}: unsupported type ${mimeType}`);
    return { skipped: true, reason: `Unsupported type: ${mimeType}` };
  }

  // 3. Check if ALTs already exist (unless overwrite is true)
  if (!overwrite) {
    const existingMetadata = upload.default_field_metadata || {};
    const hasAllAlts = locales.every(
      (locale) => existingMetadata[locale]?.alt,
    );

    if (hasAllAlts) {
      console.log(`⏭️  Skipping ${upload.filename}: ALTs already exist`);
      return { skipped: true, reason: "ALTs already exist for all locales" };
    }
  }

  // 4. Get the image URL
  let imageUrl = upload.url;
  let mediaType = "image";

  // 5. If video, extract a thumbnail frame
  if (isVideo(mimeType)) {
    console.log(`🎬 Extracting video thumbnail for ${upload.filename}...`);
    mediaType = "video";

    try {
      const base64Frame = await extractVideoThumbnail(upload.url);

      // For video, we'll use base64 directly with Claude API
      const altTexts = await generateAltTextsFromBase64(
        base64Frame,
        locales,
        upload.filename,
        mediaType,
      );

      // 6. Update DatoCMS
      const updatedMetadata = await updateUploadAlt(
        uploadId,
        altTexts,
        upload.default_field_metadata || {},
      );

      return { altTexts, metadata: updatedMetadata };
    } catch (videoError) {
      console.error(`⚠️  Video processing failed, trying URL fallback: ${videoError.message}`);
      // Some videos might have a preview image in DatoCMS
      if (upload.mux_playback_id) {
        imageUrl = `https://image.mux.com/${upload.mux_playback_id}/thumbnail.jpg`;
      } else {
        throw new Error(`Cannot process video ${upload.filename}: ${videoError.message}`);
      }
    }
  }

  // 6. Generate ALT texts via Claude Vision
  console.log(`🤖 Generating ALTs for ${upload.filename} (${mediaType})...`);
  const altTexts = await generateAltTexts(imageUrl, locales, upload.filename, mediaType);

  // 7. Update DatoCMS
  const updatedMetadata = await updateUploadAlt(
    uploadId,
    altTexts,
    upload.default_field_metadata || {},
  );

  console.log(`   ALTs: ${JSON.stringify(altTexts)}`);

  return { altTexts, metadata: updatedMetadata };
}

/**
 * Generate ALT texts from a base64-encoded image (used for video thumbnails)
 */
async function generateAltTextsFromBase64(base64Image, locales, filename, mediaType) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const context = process.env.BUSINESS_CONTEXT || "business website";
  const localeNames = {
    en: "English",
    "pl-PL": "Polish",
    pl: "Polish",
    ru: "Russian",
    de: "German",
    fr: "French",
    es: "Spanish",
  };

  const localeList = locales
    .map((l) => `"${l}" (${localeNames[l] || l})`)
    .join(", ");

  const systemPrompt = `You are an expert accessibility and SEO specialist generating ALT texts for videos on a residential real estate developer website.

BUSINESS CONTEXT: ${context}

KNOWN INVESTMENT PROJECTS (use when recognized from filename or video content):
- "Inverso" or "inverso" → Osiedle Inverso, nowe mieszkania od dewelopera, Ursus, Warszawa
- "Stasinek" or "stasinek" → Osiedle Stasinek, domy segmentowe, Białołęka, Warszawa
- "Bursztynowa" or "bursztynowa" → Osiedle przy Bursztynowej, nowe mieszkania, Łowicz

RULES FOR ALT TEXT:
1. Be descriptive but concise (80-150 characters ideally, max 200 characters)
2. Describe what is visually present in the video frame
3. Include SEO keywords naturally ONLY when they match the visual content
4. If the filename contains a project name, include it and its location
5. For building exteriors: mention building type, architectural style, surroundings
6. For interiors: mention room type, features, finishes
7. Do NOT start with "Image of...", "Video of..." — describe the content directly
8. Be specific and meaningful for SEO

You MUST respond with ONLY valid JSON. No other text, no markdown, no code blocks.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: base64Image,
            },
          },
          {
            type: "text",
            text: `This is a frame from a ${mediaType}. Analyze it and generate SEO-optimized ALT text in these languages: ${localeList}.

Filename: "${filename}"

Respond with ONLY a JSON object:
{${locales.map((l) => `"${l}": "ALT text in ${localeNames[l] || l}"`).join(", ")}}`,
          },
        ],
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

  const altTexts = JSON.parse(cleaned);

  for (const locale of locales) {
    if (!altTexts[locale]) {
      throw new Error(`Missing locale "${locale}" in response`);
    }
    if (altTexts[locale].length > 200) {
      altTexts[locale] = altTexts[locale].substring(0, 197) + "...";
    }
  }

  return altTexts;
}

module.exports = { processAsset };
