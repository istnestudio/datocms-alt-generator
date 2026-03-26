const investments = require("./investments.json");

/**
 * Match a filename to a known investment project
 *
 * @param {string} filename - Original filename of the asset
 * @returns {Object|null} - Matched investment data or null
 */
function matchInvestment(filename) {
  if (!filename) return null;

  const normalized = filename.toLowerCase();

  for (const investment of investments) {
    for (const keyword of investment.keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        return investment;
      }
    }
  }

  return null;
}

/**
 * Build investment context string for the AI prompt
 *
 * @param {string} filename
 * @returns {string} - Context to inject into prompt, or empty string
 */
function buildInvestmentContext(filename) {
  const match = matchInvestment(filename);

  if (!match) return "";

  return `
MATCHED INVESTMENT FROM FILENAME:
- Project: ${match.name}
- Type: ${match.type === "segmentowa" ? "DOMY SEGMENTOWE (townhouses) — NOT an apartment block" : "INWESTYCJA WIELORODZINNA (apartment building/block)"}
- Description: ${match.description}
- Location: ${match.location}
- SEO keywords PL: ${match.seo_pl}
- SEO keywords EN: ${match.seo_en}
- SEO keywords RU: ${match.seo_ru}

CRITICAL: This is a ${match.type === "segmentowa" ? "TOWNHOUSE/SEMI-DETACHED HOUSE (dom segmentowy)" : "APARTMENT BUILDING (blok mieszkalny)"}. Use the correct property type in ALT text. Do NOT confuse houses with apartment blocks or vice versa.`;
}

module.exports = { matchInvestment, buildInvestmentContext };
