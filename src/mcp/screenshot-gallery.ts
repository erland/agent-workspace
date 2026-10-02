export const SCREENSHOT_GALLERY_URI = "ui://agent-workspace/screenshot-gallery-v1.html";
export const SCREENSHOT_GALLERY_MIME_TYPE = "text/html;profile=mcp-app";

export const SCREENSHOT_GALLERY_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Prototype screenshot gallery</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 12px; background: transparent; }
    main { display: grid; gap: 12px; }
    .toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
    }
    .tabs { display: flex; gap: 6px; flex-wrap: wrap; }
    button {
      font: inherit;
      border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
      background: color-mix(in srgb, Canvas 94%, currentColor 6%);
      color: inherit;
      border-radius: 9px;
      padding: 7px 10px;
      cursor: pointer;
    }
    button[aria-pressed="true"] {
      background: color-mix(in srgb, CanvasText 12%, Canvas 88%);
      border-color: color-mix(in srgb, currentColor 45%, transparent);
      font-weight: 600;
    }
    .frame {
      overflow: hidden;
      border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      border-radius: 12px;
      background: Canvas;
      min-height: 180px;
      display: grid;
      place-items: center;
    }
    .frame button {
      all: unset;
      cursor: zoom-in;
      display: block;
      width: 100%;
    }
    img {
      display: block;
      width: 100%;
      height: auto;
      max-height: 72vh;
      object-fit: contain;
      background: Canvas;
    }
    .meta {
      display: flex;
      gap: 8px 12px;
      flex-wrap: wrap;
      font-size: 12px;
      opacity: .72;
    }
    .status { padding: 24px; text-align: center; opacity: .7; }
    @media (max-width: 520px) {
      .toolbar { align-items: stretch; }
      .tabs { width: 100%; }
      .tabs button { flex: 1 1 auto; }
    }
  </style>
</head>
<body>
  <main>
    <div class="toolbar">
      <div id="tabs" class="tabs" role="tablist" aria-label="Screenshots"></div>
      <button id="fullscreen" type="button">Open larger</button>
    </div>
    <div class="frame">
      <div id="status" class="status">Loading screenshots…</div>
      <button id="imageButton" type="button" title="Open larger" hidden>
        <img id="image" alt="Prototype screenshot" />
      </button>
    </div>
    <div id="meta" class="meta"></div>
  </main>
  <script>
    (() => {
      const tabs = document.getElementById("tabs");
      const image = document.getElementById("image");
      const imageButton = document.getElementById("imageButton");
      const status = document.getElementById("status");
      const meta = document.getElementById("meta");
      const fullscreen = document.getElementById("fullscreen");

      let gallery = [];
      let selectedId = null;

      function persistedSelectedId() {
        return window.openai?.widgetState?.privateContent?.selectedArtifactId ?? null;
      }

      function persistSelection(id) {
        window.openai?.setWidgetState?.({
          modelContent: "Selected prototype screenshot: " + id,
          privateContent: { selectedArtifactId: id }
        });
      }

      function selected() {
        return gallery.find((item) => item.artifactId === selectedId) ?? gallery[0];
      }

      function renderTabs() {
        tabs.replaceChildren();
        for (const item of gallery) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = item.label;
          button.setAttribute("role", "tab");
          button.setAttribute("aria-pressed", String(item.artifactId === selectedId));
          button.addEventListener("click", () => {
            selectedId = item.artifactId;
            persistSelection(selectedId);
            render();
          });
          tabs.appendChild(button);
        }
      }

      function render() {
        const item = selected();
        if (!item) {
          status.textContent = "No screenshots available.";
          status.hidden = false;
          imageButton.hidden = true;
          meta.textContent = "";
          return;
        }

        selectedId = item.artifactId;
        renderTabs();
        image.src = "data:" + item.mimeType + ";base64," + item.data;
        image.alt = item.label + " prototype screenshot";
        imageButton.hidden = false;
        status.hidden = true;

        const parts = [item.label];
        if (item.width && item.height) parts.push(item.width + "×" + item.height);
        if (item.fileName) parts.push(item.fileName);
        if (item.byteSize) parts.push(Math.round(item.byteSize / 1024) + " KB");
        meta.textContent = parts.join(" · ");
      }

      function applyToolResult(toolResult) {
        const structured = toolResult?.structuredContent?.result ?? window.openai?.toolOutput?.result;
        const payload = toolResult?._meta?.gallery ?? window.openai?.toolResponseMetadata?._meta?.gallery;
        if (!structured || structured.status !== "PASSED" || !Array.isArray(payload?.screenshots)) {
          status.textContent = "Screenshot gallery unavailable.";
          return;
        }

        gallery = payload.screenshots;
        const preferred = persistedSelectedId() || structured.selectedArtifactId;
        selectedId = gallery.some((item) => item.artifactId === preferred)
          ? preferred
          : gallery[0]?.artifactId ?? null;
        render();
      }

      async function openLarger() {
        if (window.openai?.requestDisplayMode) {
          await window.openai.requestDisplayMode({ mode: "fullscreen" });
        }
      }

      fullscreen.addEventListener("click", openLarger);
      imageButton.addEventListener("click", openLarger);

      window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;
        if (message.method === "ui/notifications/tool-result") {
          applyToolResult(message.params);
        }
      }, { passive: true });

      if (window.openai?.toolOutput || window.openai?.toolResponseMetadata) {
        applyToolResult({
          structuredContent: window.openai?.toolOutput,
          _meta: window.openai?.toolResponseMetadata?._meta
        });
      }

      window.parent.postMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "ui/initialize",
        params: {
          appInfo: { name: "agent-workspace-screenshot-gallery", version: "1.0.0" },
          appCapabilities: {},
          protocolVersion: "2026-01-26"
        }
      }, "*");
      window.parent.postMessage({
        jsonrpc: "2.0",
        method: "ui/notifications/initialized",
        params: {}
      }, "*");
    })();
  </script>
</body>
</html>`;
