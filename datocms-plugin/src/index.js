import { connect } from "datocms-plugin-sdk";

connect({
  manualFieldExtensions() {
    return [];
  },

  renderConfigScreen(ctx) {
    const container = document.getElementById("root");
    if (!container) return;

    const params = ctx.plugin.attributes.parameters || {};
    const currentUrl = params.translationServerUrl || "";

    container.innerHTML = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 16px; max-width: 500px;">
        <h2 style="font-size: 18px; margin-bottom: 16px;">AI Translator — Ustawienia</h2>
        <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px;">Translation Server URL</label>
        <input id="serverUrlInput" type="text" value="${currentUrl}"
          placeholder="https://datocms-alt-generator.onrender.com"
          style="width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; box-sizing: border-box;" />
        <p style="font-size: 12px; color: #64748b; margin-top: 6px;">URL serwera Render (bez ukośnika na końcu)</p>
        <button id="saveBtn"
          style="margin-top: 16px; padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;">Zapisz</button>
        <div id="saveStatus" style="margin-top: 8px; font-size: 13px;"></div>
      </div>
    `;

    document.getElementById("saveBtn").addEventListener("click", function () {
      var url = document.getElementById("serverUrlInput").value.replace(/\/$/, "");
      ctx.updatePluginParameters({ ...params, translationServerUrl: url })
        .then(function () {
          document.getElementById("saveStatus").innerHTML = '<span style="color: #16a34a;">✅ Zapisano!</span>';
        })
        .catch(function (e) {
          document.getElementById("saveStatus").innerHTML = '<span style="color: #dc2626;">❌ ' + e.message + '</span>';
        });
    });

    return { destroy() { container.innerHTML = ""; } };
  },

  itemFormSidebarPanels() {
    return [{ id: "aiTranslator", label: "AI Tłumaczenie", startOpen: true }];
  },

  renderItemFormSidebarPanel(sidebarPaneId, ctx) {
    const container = document.getElementById("root");
    if (!container) return;

    // Server URL
    var serverUrl = "https://datocms-alt-generator.onrender.com";
    try {
      var p = (ctx.plugin && ctx.plugin.attributes && ctx.plugin.attributes.parameters) || {};
      if (p.translationServerUrl) serverUrl = p.translationServerUrl.replace(/\/$/, "");
    } catch (e) {}

    var locales = ["pl-PL", "en", "ru"];
    try { locales = ctx.site.attributes.locales || locales; } catch (e) {}
    var sourceLocale = locales[0];
    var targetLocales = locales.slice(1);

    container.innerHTML = `
      <style>
        #translator-root { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 0; color: #1a1a2e; }
        .btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 12px 16px; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .btn-primary { background: #2563eb; color: white; }
        .btn-primary:hover { background: #1d4ed8; }
        .btn-primary:disabled { background: #93c5fd; cursor: not-allowed; }
        .btn-secondary { background: #f1f5f9; color: #475569; margin-top: 8px; }
        .btn-secondary:hover { background: #e2e8f0; }
        .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
        .status { margin-top: 12px; padding: 10px 12px; border-radius: 6px; font-size: 13px; line-height: 1.5; word-break: break-word; }
        .status-info { background: #eff6ff; color: #1e40af; }
        .status-success { background: #f0fdf4; color: #166534; }
        .status-error { background: #fef2f2; color: #991b1b; }
        .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.6s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .field-count { margin-top: 8px; font-size: 12px; color: #94a3b8; text-align: center; }
        .server-url { margin-top: 4px; font-size: 11px; color: #94a3b8; text-align: center; word-break: break-all; }
      </style>
      <div id="translator-root">
        <button class="btn btn-primary" id="translateBtn">Przetłumacz na EN + RU</button>
        <button class="btn btn-secondary" id="translateOverwriteBtn">Nadpisz istniejące tłumaczenia</button>
        <div class="field-count" id="fieldCount"></div>
        <div class="server-url" id="serverInfo"></div>
        <div id="statusContainer"></div>
      </div>
    `;

    var serverInfo = document.getElementById("serverInfo");
    serverInfo.textContent = serverUrl ? "Serwer: " + serverUrl : "⚠ Brak URL serwera";

    // ── Read localized string/text fields from formValues ──
    function getFormFields() {
      var fields = {};
      try {
        var allFields = ctx.fields || {};
        for (var fieldId in allFields) {
          var field = allFields[fieldId];
          var attrs = field.attributes || {};
          if (!attrs.localized) continue;
          if (attrs.field_type !== "string" && attrs.field_type !== "text") continue;

          var apiKey = attrs.api_key;
          var formVal = ctx.formValues[apiKey];

          // Localized field: formValues[apiKey] = { "pl-PL": "...", "en": "..." }
          if (formVal && typeof formVal === "object" && formVal[sourceLocale]) {
            var val = formVal[sourceLocale];
            if (typeof val === "string" && val.trim()) {
              fields[apiKey] = val;
            }
          }
        }
      } catch (e) {
        setStatus("Błąd odczytu pól: " + e.message, "error");
      }
      return fields;
    }

    function updateFieldCount() {
      var fields = getFormFields();
      var count = Object.keys(fields).length;
      var el = document.getElementById("fieldCount");
      if (el) el.textContent = count > 0 ? count + " pól do przetłumaczenia" : "Brak pól z polską treścią";
    }

    function setStatus(msg, type) {
      var c = document.getElementById("statusContainer");
      if (c) c.innerHTML = '<div class="status status-' + (type || "info") + '">' + msg + '</div>';
    }

    function setLoading(on) {
      var b1 = document.getElementById("translateBtn");
      var b2 = document.getElementById("translateOverwriteBtn");
      b1.disabled = on; b2.disabled = on;
      b1.innerHTML = on ? '<span class="spinner"></span> Tłumaczenie...' : 'Przetłumacz na EN + RU';
    }

    // ── Main handler — async so we can await setFieldValue ──
    async function handleTranslate(overwrite) {
      setStatus("Rozpoczynam...", "info");

      try {
        if (!serverUrl) {
          setStatus("Brak URL serwera — skonfiguruj w Settings → Plugins", "error");
          return;
        }

        var fields = getFormFields();
        var fieldKeys = Object.keys(fields);
        if (fieldKeys.length === 0) {
          setStatus("Brak pól z polską treścią do przetłumaczenia", "error");
          return;
        }

        var modelName = "unknown";
        try { modelName = ctx.itemType.attributes.api_key; } catch (e) {}

        setLoading(true);
        setStatus("Tłumaczenie " + fieldKeys.length + " pól...", "info");

        var response = await fetch(serverUrl + "/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: fields,
            sourceLocale: sourceLocale,
            targetLocales: targetLocales,
            modelName: modelName,
          }),
        });

        if (!response.ok) {
          var errData = {};
          try { errData = await response.json(); } catch (e) {}
          throw new Error(errData.error || "Server error: " + response.status);
        }

        var translations = await response.json();
        var debugLog = [];
        var filledCount = 0;

        for (var li = 0; li < targetLocales.length; li++) {
          var locale = targetLocales[li];
          if (!translations[locale]) {
            debugLog.push("Brak tłumaczeń dla: " + locale);
            continue;
          }

          var translatedFields = translations[locale];
          for (var fi = 0; fi < fieldKeys.length; fi++) {
            var fieldApiKey = fieldKeys[fi];
            var translatedValue = translatedFields[fieldApiKey];
            if (!translatedValue) {
              debugLog.push(fieldApiKey + "." + locale + " = null");
              continue;
            }

            // Check existing value in formValues
            var currentFormVal = ctx.formValues[fieldApiKey];
            if (currentFormVal && typeof currentFormVal === "object") {
              var existingVal = currentFormVal[locale];
              if (existingVal && String(existingVal).trim() && !overwrite) {
                debugLog.push(fieldApiKey + "." + locale + " = istnieje, pominięto");
                continue;
              }
            }

            // ── SET VALUE: use the path that maps to formValues ──
            // For localized field "title", formValues.title = { "pl-PL": "x", "en": "y" }
            // Path "title.en" should set formValues.title.en = value
            var setPath = fieldApiKey + "." + locale;
            try {
              await ctx.setFieldValue(setPath, translatedValue);
              filledCount++;
              debugLog.push(fieldApiKey + "." + locale + " = ✅ OK");
            } catch (e1) {
              debugLog.push(fieldApiKey + "." + locale + " setFieldValue err: " + e1.message);
              // Fallback: set entire localized object
              try {
                var fullObj = Object.assign({}, ctx.formValues[fieldApiKey] || {});
                fullObj[locale] = translatedValue;
                await ctx.setFieldValue(fieldApiKey, fullObj);
                filledCount++;
                debugLog.push(fieldApiKey + "." + locale + " = ✅ OK (fallback)");
              } catch (e2) {
                debugLog.push(fieldApiKey + "." + locale + " FALLBACK err: " + e2.message);
              }
            }
          }
        }

        var msg = filledCount > 0
          ? "✅ Wypełniono " + filledCount + " pól. Kliknij Save aby zapisać."
          : "⚠ Nie wypełniono żadnych pól.";
        msg += "<br><br><b>Debug:</b><br>" + debugLog.join("<br>");
        setStatus(msg, filledCount > 0 ? "success" : "error");

      } catch (e) {
        setStatus("❌ Błąd: " + e.message, "error");
      } finally {
        setLoading(false);
      }
    }

    document.getElementById("translateBtn").addEventListener("click", function () { handleTranslate(false); });
    document.getElementById("translateOverwriteBtn").addEventListener("click", function () { handleTranslate(true); });
    updateFieldCount();

    return { destroy() { container.innerHTML = ""; } };
  },
});
