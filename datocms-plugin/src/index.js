import { connect } from "datocms-plugin-sdk";

connect({
  // Declare the sidebar panel
  itemFormSidebarPanels(itemType, ctx) {
    return [
      {
        id: "aiTranslator",
        label: "AI Tłumaczenie",
        startOpen: true,
      },
    ];
  },

  // Render the sidebar panel UI
  renderItemFormSidebarPanel(sidebarPaneId, ctx) {
    const container = document.getElementById("root");
    if (!container) return;

    const serverUrl = (
      ctx.plugin.attributes.parameters.translationServerUrl || ""
    ).replace(/\/$/, "");
    const locales = ctx.site.attributes.locales;
    const sourceLocale = locales[0]; // pl-PL
    const targetLocales = locales.slice(1); // [en, ru]

    // ── Styles ──
    container.innerHTML = `
      <style>
        #translator-root {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          padding: 0;
          color: #1a1a2e;
        }
        .btn {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          width: 100%; padding: 12px 16px; border: none; border-radius: 8px;
          font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .btn-primary { background: #2563eb; color: white; }
        .btn-primary:hover { background: #1d4ed8; }
        .btn-primary:disabled { background: #93c5fd; cursor: not-allowed; }
        .btn-secondary { background: #f1f5f9; color: #475569; margin-top: 8px; }
        .btn-secondary:hover { background: #e2e8f0; }
        .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
        .status { margin-top: 12px; padding: 10px 12px; border-radius: 6px; font-size: 13px; line-height: 1.4; }
        .status-info { background: #eff6ff; color: #1e40af; }
        .status-success { background: #f0fdf4; color: #166534; }
        .status-error { background: #fef2f2; color: #991b1b; }
        .spinner {
          display: inline-block; width: 16px; height: 16px;
          border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
          border-radius: 50%; animation: spin 0.6s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .field-count { margin-top: 8px; font-size: 12px; color: #94a3b8; text-align: center; }
      </style>
      <div id="translator-root">
        <button class="btn btn-primary" id="translateBtn">Przetłumacz na EN + RU</button>
        <button class="btn btn-secondary" id="translateOverwriteBtn">Nadpisz istniejące tłumaczenia</button>
        <div class="field-count" id="fieldCount"></div>
        <div id="statusContainer"></div>
      </div>
    `;

    // ── Helper: get localized text fields with Polish content ──
    function getFormFields() {
      const fields = {};
      for (const field of Object.values(ctx.fields)) {
        if (!field.attributes.localized) continue;
        const fieldType = field.attributes.field_type;
        if (!["string", "text"].includes(fieldType)) continue;

        const apiKey = field.attributes.api_key;
        const value = ctx.getFieldValue(apiKey + "." + sourceLocale);

        if (value && typeof value === "string" && value.trim()) {
          fields[apiKey] = value;
        }
      }
      return fields;
    }

    // ── Update field count ──
    function updateFieldCount() {
      const fields = getFormFields();
      const count = Object.keys(fields).length;
      const el = document.getElementById("fieldCount");
      if (el) {
        el.textContent =
          count > 0
            ? `${count} pól do przetłumaczenia`
            : "Brak pól z polską treścią";
      }
    }

    function setStatus(message, type = "info") {
      const c = document.getElementById("statusContainer");
      if (c) c.innerHTML = `<div class="status status-${type}">${message}</div>`;
    }

    function setLoading(loading) {
      const btn = document.getElementById("translateBtn");
      const btn2 = document.getElementById("translateOverwriteBtn");
      if (loading) {
        btn.disabled = true;
        btn2.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Tłumaczenie...';
      } else {
        btn.disabled = false;
        btn2.disabled = false;
        btn.innerHTML = "Przetłumacz na EN + RU";
      }
    }

    // ── Main translate handler ──
    async function handleTranslate(overwrite = false) {
      if (!serverUrl) {
        setStatus(
          "Skonfiguruj URL serwera w ustawieniach pluginu (translationServerUrl)",
          "error"
        );
        return;
      }

      const fields = getFormFields();
      if (Object.keys(fields).length === 0) {
        setStatus("Brak pól z polską treścią do przetłumaczenia", "error");
        return;
      }

      const modelName = ctx.itemType.attributes.api_key;

      setLoading(true);
      setStatus(`Tłumaczenie ${Object.keys(fields).length} pól...`, "info");

      try {
        const response = await fetch(`${serverUrl}/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields,
            sourceLocale,
            targetLocales,
            modelName,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Server error: ${response.status}`);
        }

        const translations = await response.json();

        let filledCount = 0;
        for (const locale of targetLocales) {
          if (!translations[locale]) continue;

          for (const [fieldApiKey, translatedValue] of Object.entries(
            translations[locale]
          )) {
            if (!translatedValue) continue;

            const existingValue = ctx.getFieldValue(
              fieldApiKey + "." + locale
            );
            if (existingValue && existingValue.trim() && !overwrite) {
              continue;
            }

            ctx.setFieldValue(fieldApiKey + "." + locale, translatedValue);
            filledCount++;
          }
        }

        setStatus(
          `✅ Przetłumaczono! Wypełniono ${filledCount} pól. Kliknij "Save" aby zapisać.`,
          "success"
        );
      } catch (error) {
        console.error("Translation error:", error);
        setStatus(`❌ Błąd: ${error.message}`, "error");
      } finally {
        setLoading(false);
      }
    }

    // ── Event listeners ──
    document
      .getElementById("translateBtn")
      .addEventListener("click", () => handleTranslate(false));
    document
      .getElementById("translateOverwriteBtn")
      .addEventListener("click", () => handleTranslate(true));

    updateFieldCount();

    // Cleanup
    return {
      destroy() {
        container.innerHTML = "";
      },
    };
  },
});
