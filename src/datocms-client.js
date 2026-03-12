const { buildClient } = require("@datocms/cma-client-node");

let client = null;

function getDatocmsClient() {
  if (!client) {
    if (!process.env.DATOCMS_API_TOKEN) {
      throw new Error("DATOCMS_API_TOKEN is not set");
    }
    client = buildClient({ apiToken: process.env.DATOCMS_API_TOKEN });
  }
  return client;
}

/**
 * Fetch a single upload/asset by ID
 */
async function getUpload(uploadId) {
  const c = getDatocmsClient();
  return c.uploads.find(uploadId);
}

/**
 * Update an upload's default_field_metadata with ALT texts
 *
 * @param {string} uploadId
 * @param {Object} altTexts - { en: "...", pl: "...", ru: "..." }
 * @param {Object} existingMetadata - current default_field_metadata
 */
async function updateUploadAlt(uploadId, altTexts, existingMetadata = {}) {
  const c = getDatocmsClient();

  // Merge new ALTs into existing metadata, preserving other fields (title, custom_data, focal_point)
  const updatedMetadata = { ...existingMetadata };

  for (const [locale, altText] of Object.entries(altTexts)) {
    updatedMetadata[locale] = {
      ...(updatedMetadata[locale] || {}),
      alt: altText,
    };
  }

  await c.uploads.update(uploadId, {
    default_field_metadata: updatedMetadata,
  });

  return updatedMetadata;
}

module.exports = { getDatocmsClient, getUpload, updateUploadAlt };
