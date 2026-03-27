import { connect } from "datocms-plugin-sdk";

connect({
  // Declare global parameters (shows in plugin settings)
  manualFieldExtensions() {
    return [];
  },

  // Override to declare plugin parameters for the settings screen
  renderConfigScreen(ctx) {
    const container = document.getElementById("root");
    if (!container) return;

    const params = (ctx.plugin.attributes.parameters) || {};
    const currentUrl = params.translationServerUrl || "";

    container.innerHTML = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 16px; max-width: 500px;">
        <h2 style="font-size: 18px; margin-bottom: 16px;">AI Translator — Ustawienia</h2>
        <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px;">
          Translation Server URL
        </label>
        <input
          id="serverUrlInput"
          type="text"
          value="${currentUrl}"
          placeholder="https://datocms-alt-generator.onrender.com"
          style="width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; box-sizing: border-box;"
        />
        <p style="font-size: 12px; color: #64748b; margin-top: 6px;">
          URL serwera Render z endpointem /translate (bez ukośnika na końcu)
        </p>
        <button
          id="saveBtn"
          style="margin-top: 16px; padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;"
        >
          Zapisz
        </button>
        <div id="saveStatus" style="margin-top: 8px; font-size: 13px;"></div>
      </div>
    `;

    document.getElementById("saveBtn").addEventListener("click", function() {
      var url = document.getElementById("serverUrlInput").value.replace(/\/$/, "");
      ctx.updatePluginParameters({
        ...params,
        translationServerUrl: url,
      }).then(function() {
        document.getElementById("saveStatus").innerHTML =
          '<span style="color: #16a34a;">✅ Zapisano!</span>';
      }).catch(function(e) {
        document.getElementById("saveStatus").innerHTML =
          '<span style="color: #dc2626;">❌ Błąd: ' + e.message + '</span>';
      });
    });

    return {
      destroy: function() { container.innerHTML = ""; },
    };
  },

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
    if (!container) {
      document.body.innerHTML = '<div style="color:red;padding:16px;">Brak elementu #root</div>';
      return;
    }

    // Server URL — hardcoded fallback, can be overridden via plugin parameters
    var serverUrl = "https://datocms-alt-generator.onrender.com";
    try {
      var params = (ctx.plugin && ctx.plugin.attributes && ctx.plugin.attributes.parameters) || {};
      if (params.translationServerUrl) {
        serverUrl = params.translationServerUrl.replace(/\/$/, "");
      }
    } catch (e) {
      // use hardcoded fallback
    }

    let locales = ["pl-PL", "en", "ru"];
    try {
      locales = ctx.site.attributes.locales || locales;
    } catch (e) {
      // fallback
    }
    const sourceLocale = locales[0];
    const targetLocales = locales.slice(1);

    // ── Render UI ──
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
        .status { margin-top: 12px; padding: 10px 12px; border-radius: 6px; font-size: 13px; line-height: 1.4; word-break: break-word; }
        .status-info { background: #eff6ff; color: #1e40af; }
        .status-success { background: #f0fdf4; color: #166534; }
        .status-error { background: #fef2f2; color: #991b1b; }
        .status-debug { background: #fefce8; color: #854d0e; font-family: monospace; font-size: 11px; white-space: pre-wrap; }
        .spinner {
          display: inline-block; width: 16px; height: 16px;
          border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
          border-radius: 50%; animation: spin 0.6s linear infinite;
        }
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

    // Show server URL status
    const serverInfo = document.getElementById("serverInfo");
    if (serverUrl) {
      serverInfo.textContent = "Serwer: " + serverUrl;
    } else {
      serverInfo.innerHTML = '<span style="color:#dc2626;">⚠ Brak URL serwera w ustawieniach pluginu</span>';
    }

    // ── Helper: get localized text fields with Polish content ──
    function getFormFields() {
      const fields = {};
      try {
        const allFields = ctx.fields || {};
        for (const field of Object.values(allFields)) {
          const attrs = field.attributes || {};
          if (!attrs.localized) continue;
          if (!["string", "text"].includes(attrs.field_type)) continue;

          const apiKey = attrs.api_key;
          let value = null;

          // Method 1: formValues
          try {
            const fv = ctx.formValues || {};
            if (fv[apiKey]) {
              const formVal = fv[apiKey];
              if (typeof formVal === "object" && formVal !== null) {
                value = formVal[sourceLocale];
              } else if (typeof formVal === "string") {
                value = formVal;
              }
            }
          } catch (e) { /* ignore */ }

          // Method 2: getFieldValue with dot notation
          if (!value) {
            try {
              const v = ctx.getFieldValue(apiKey + "." + sourceLocale);
              if (typeof v === "string") value = v;
            } catch (e) { /* ignore */ }
          }

          // Method 3: getFieldValue returns full localized object
          if (!value) {
            try {
              const v = ctx.getFieldValue(apiKey);
              if (typeof v === "object" && v !== null) value = v[sourceLocale];
              else if (typeof v === "string") value = v;
            } catch (e) { /* ignore */ }
          }

          if (value && typeof value === "string" && value.trim()) {
            fields[apiKey] = value;
          }
        }
      } catch (e) {
        setStatus("Błąd odczytu pól: " + e.message, "error");
      }
      return fields;
    }

    function updateFieldCount() {
      try {
        const fields = getFormFields();
        const count = Object.keys(fields).length;
        const el = document.getElementById("fieldCount");
        if (el) {
          el.textContent = count > 0
            ? count + " pól do przetłumaczenia"
            : "Brak pól z polską treścią";
        }
      } catch (e) {
        // silent
      }
    }

    function setStatus(message, type) {
      type = type || "info";
      var c = document.getElementById("statusContainer");
      if (c) c.innerHTML = '<div class="status status-' + type + '">' + message + '</div>';
    }

    function setLoading(loading) {
      var btn = document.getElementById("translateBtn");
      var btn2 = document.getElementById("translateOverwriteBtn");
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
    function handleTranslate(overwrite) {
      // Immediate visual feedback
      setStatus("Rozpoczynam...", "info");

      try {
        if (!serverUrl) {
          setStatus("Skonfiguruj translationServerUrl w Settings → Plugins → AI Translator → Parameters", "error");
          return;
        }

        var fields = getFormFields();
        if (Object.keys(fields).length === 0) {
          setStatus("Brak pól z polską treścią do przetłumaczenia", "error");
          return;
        }

        var modelName = "unknown";
        try {
          modelName = ctx.itemType.attributes.api_key;
        } catch (e) { /* ignore */ }

        setLoading(true);
        setStatus("Tłumaczenie " + Object.keys(fields).length + " pól...", "info");

        fetch(serverUrl + "/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: fields,
            sourceLocale: sourceLocale,
            targetLocales: targetLocales,
            modelName: modelName,
          }),
        })
        .then(function(response) {
          if (!response.ok) {
            return response.json().catch(function() { return {}; }).then(function(errData) {
              throw new Error(errData.error || "Server error: " + response.status);
            });
          }
          return response.json();
        })
        .then(function(translations) {
          var filledCount = 0;
          var debugLog = [];

          targetLocales.forEach(function(locale) {
            if (!translations[locale]) {
              debugLog.push("Brak tłumaczeń dla locale: " + locale);
              return;
            }
            Object.keys(translations[locale]).forEach(function(fieldApiKey) {
              var translatedValue = translations[locale][fieldApiKey];
              if (!translatedValue) {
                debugLog.push(fieldApiKey + "." + locale + " = null (pominięto)");
                return;
              }

              // Check existing value
              var existingValue = null;
              try {
                var fv = ctx.formValues || {};
                if (fv[fieldApiKey] && typeof fv[fieldApiKey] === "object") {
                  existingValue = fv[fieldApiKey][locale];
                }
              } catch(e) {}

              if (existingValue && String(existingValue).trim() && !overwrite) {
                debugLog.push(fieldApiKey + "." + locale + " = istnieje, pominięto");
                return;
              }

              // Strategy 1: set full localized object
              var setOk = false;
              try {
                var currentFull = ctx.getFieldValue(fieldApiKey);
                if (typeof currentFull === "object" && currentFull !== null) {
                  var updated = Object.assign({}, currentFull);
                  updated[locale] = translatedValue;
                  ctx.setFieldValue(fieldApiKey, updated);
                  setOk = true;
                  debugLog.push(fieldApiKey + "." + locale + " = OK (full object)");
                }
              } catch(e) {
                debugLog.push(fieldApiKey + "." + locale + " full object err: " + e.message);
              }

              // Strategy 2: dot notation
              if (!setOk) {
                try {
                  ctx.setFieldValue(fieldApiKey + "." + locale, translatedValue);
                  setOk = true;
                  debugLog.push(fieldApiKey + "." + locale + " = OK (dot notation)");
                } catch(e) {
                  debugLog.push(fieldApiKey + "." + locale + " dot err: " + e.message);
                }
              }

              // Strategy 3: try toggling locale via setFieldValue(path, locale, value)
              if (!setOk) {
                try {
                  ctx.setFieldValue(fieldApiKey, translatedValue, locale);
                  setOk = true;
                  debugLog.push(fieldApiKey + "." + locale + " = OK (3-arg)");
                } catch(e) {
                  debugLog.push(fieldApiKey + "." + locale + " 3-arg err: " + e.message);
                }
              }

              if (setOk) filledCount++;
            });
          });

          var msg = "✅ Przetłumaczono! Wypełniono " + filledCount + " pól. Kliknij Save aby zapisać.";
          if (debugLog.length > 0) {
            msg += "<br><br><strong>Debug:</strong><br>" + debugLog.join("<br>");
          }
          setStatus(msg, filledCount > 0 ? "success" : "error");
        })
        .catch(function(error) {
          setStatus("❌ Błąd: " + error.message, "error");
        })
        .finally(function() {
          setLoading(false);
        });

      } catch (e) {
        setStatus("❌ Wyjątek: " + e.message, "error");
        setLoading(false);
      }
    }

    // ── Event listeners ──
    document.getElementById("translateBtn").addEventListener("click", function() {
      handleTranslate(false);
    });
    document.getElementById("translateOverwriteBtn").addEventListener("click", function() {
      handleTranslate(true);
    });

    updateFieldCount();

    return {
      destroy: function() {
        container.innerHTML = "";
      },
    };
  },
});
