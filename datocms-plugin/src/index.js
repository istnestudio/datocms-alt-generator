import { connect } from "datocms-plugin-sdk";

connect({
  manualFieldExtensions() {
    return [];
  },

  renderConfigScreen(ctx) {
    var container = document.getElementById("root");
    if (!container) return;
    var params = ctx.plugin.attributes.parameters || {};
    var currentUrl = params.translationServerUrl || "";

    container.innerHTML =
      '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:16px;max-width:500px;">' +
      '<h2 style="font-size:18px;margin-bottom:16px;">AI Translator — Ustawienia</h2>' +
      '<label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Translation Server URL</label>' +
      '<input id="serverUrlInput" type="text" value="' + currentUrl + '" placeholder="https://datocms-alt-generator.onrender.com" style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;" />' +
      '<p style="font-size:12px;color:#64748b;margin-top:6px;">URL serwera Render (bez ukośnika na końcu)</p>' +
      '<button id="saveBtn" style="margin-top:16px;padding:10px 20px;background:#2563eb;color:white;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">Zapisz</button>' +
      '<div id="saveStatus" style="margin-top:8px;font-size:13px;"></div></div>';

    document.getElementById("saveBtn").addEventListener("click", function () {
      var url = document.getElementById("serverUrlInput").value.replace(/\/$/, "");
      ctx.updatePluginParameters(Object.assign({}, params, { translationServerUrl: url }))
        .then(function () { document.getElementById("saveStatus").innerHTML = '<span style="color:#16a34a;">✅ Zapisano!</span>'; })
        .catch(function (e) { document.getElementById("saveStatus").innerHTML = '<span style="color:#dc2626;">❌ ' + e.message + '</span>'; });
    });

    return { destroy: function () { container.innerHTML = ""; } };
  },

  itemFormSidebarPanels() {
    return [{ id: "aiTranslator", label: "AI Tłumaczenie", startOpen: true }];
  },

  renderItemFormSidebarPanel(sidebarPaneId, ctx) {
    var container = document.getElementById("root");
    if (!container) return;

    // Server URL
    var serverUrl = "https://datocms-alt-generator.onrender.com";
    try {
      var p = (ctx.plugin && ctx.plugin.attributes && ctx.plugin.attributes.parameters) || {};
      if (p.translationServerUrl) serverUrl = p.translationServerUrl.replace(/\/$/, "");
    } catch (e) {}

    // Record ID
    var recordId = null;
    try {
      recordId = ctx.item && ctx.item.id;
    } catch (e) {}

    container.innerHTML =
      '<style>' +
      '#translator-root{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:0;color:#1a1a2e}' +
      '.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px 16px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:all .2s}' +
      '.btn-primary{background:#2563eb;color:#fff}.btn-primary:hover{background:#1d4ed8}.btn-primary:disabled{background:#93c5fd;cursor:not-allowed}' +
      '.btn-secondary{background:#f1f5f9;color:#475569;margin-top:8px}.btn-secondary:hover{background:#e2e8f0}.btn-secondary:disabled{opacity:.5;cursor:not-allowed}' +
      '.status{margin-top:12px;padding:10px 12px;border-radius:6px;font-size:13px;line-height:1.5;word-break:break-word}' +
      '.status-info{background:#eff6ff;color:#1e40af}.status-success{background:#f0fdf4;color:#166534}.status-error{background:#fef2f2;color:#991b1b}' +
      '.spinner{display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite}' +
      '@keyframes spin{to{transform:rotate(360deg)}}' +
      '.meta{margin-top:8px;font-size:11px;color:#94a3b8;text-align:center;word-break:break-all}' +
      '</style>' +
      '<div id="translator-root">' +
      '<button class="btn btn-primary" id="translateBtn">Przetłumacz na EN + RU</button>' +
      '<button class="btn btn-secondary" id="translateOverwriteBtn">Nadpisz istniejące tłumaczenia</button>' +
      '<div class="meta" id="metaInfo"></div>' +
      '<div id="statusContainer"></div>' +
      '</div>';

    // Show metadata
    var metaEl = document.getElementById("metaInfo");
    metaEl.textContent = recordId
      ? "Rekord: " + recordId + " | Serwer: " + serverUrl
      : "⚠ Nie można odczytać ID rekordu";

    function setStatus(msg, type) {
      var c = document.getElementById("statusContainer");
      if (c) c.innerHTML = '<div class="status status-' + (type || "info") + '">' + msg + '</div>';
    }

    function setLoading(on) {
      var b1 = document.getElementById("translateBtn");
      var b2 = document.getElementById("translateOverwriteBtn");
      if (b1) { b1.disabled = on; b1.innerHTML = on ? '<span class="spinner"></span> Tłumaczenie...' : 'Przetłumacz na EN + RU'; }
      if (b2) b2.disabled = on;
    }

    async function handleTranslate(overwrite) {
      if (!serverUrl) {
        setStatus("Brak URL serwera", "error");
        return;
      }
      if (!recordId) {
        setStatus("Nie można odczytać ID rekordu. Zapisz rekord i spróbuj ponownie.", "error");
        return;
      }

      setLoading(true);
      setStatus("Wysyłanie do serwera...", "info");

      try {
        var response = await fetch(serverUrl + "/translate-record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordId: recordId, overwrite: overwrite }),
        });

        var data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Server error: " + response.status);
        }

        if (data.status === "skipped") {
          setStatus("⏭ " + data.message, "info");
        } else {
          setStatus("✅ " + data.message + "<br>Odśwież stronę (F5) aby zobaczyć tłumaczenia.", "success");
        }
      } catch (e) {
        setStatus("❌ Błąd: " + e.message, "error");
      } finally {
        setLoading(false);
      }
    }

    document.getElementById("translateBtn").addEventListener("click", function () { handleTranslate(false); });
    document.getElementById("translateOverwriteBtn").addEventListener("click", function () { handleTranslate(true); });

    return { destroy: function () { container.innerHTML = ""; } };
  },
});
