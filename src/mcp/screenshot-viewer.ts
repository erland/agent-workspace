export const SCREENSHOT_VIEWER_URI = "ui://agent-workspace/screenshot-viewer-v1.html";
export const SCREENSHOT_VIEWER_MIME_TYPE = "text/html;profile=mcp-app";

export const SCREENSHOT_VIEWER_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Prototype screenshot</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px;
      background: transparent;
    }
    main {
      display: grid;
      gap: 10px;
      width: 100%;
    }
    .frame {
      overflow: hidden;
      border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      border-radius: 12px;
      background: color-mix(in srgb, Canvas 96%, currentColor 4%);
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
      flex-wrap: wrap;
      gap: 6px 12px;
      align-items: center;
      font-size: 12px;
      opacity: .72;
    }
    .status {
      padding: 20px;
      text-align: center;
      font-size: 14px;
      opacity: .72;
    }
  </style>
</head>
<body>
  <main>
    <div class="frame">
      <div id="status" class="status">Loading screenshot…</div>
      <img id="image" alt="Prototype screenshot" hidden />
    </div>
    <div id="meta" class="meta"></div>
  </main>
  <script>
    (() => {
      const image = document.getElementById("image");
      const status = document.getElementById("status");
      const meta = document.getElementById("meta");

      function render(toolResult) {
        const structured = toolResult?.structuredContent?.result ?? window.openai?.toolOutput?.result;
        const screenshot = toolResult?._meta?.screenshot ?? window.openai?.toolResponseMetadata?._meta?.screenshot;

        if (!structured || structured.status !== "PASSED") {
          status.textContent = structured?.failureSummary || "Screenshot unavailable.";
          image.hidden = true;
          return;
        }

        if (!screenshot?.data || screenshot.mimeType !== "image/png") {
          status.textContent = "Screenshot data is unavailable.";
          image.hidden = true;
          return;
        }

        image.src = "data:" + screenshot.mimeType + ";base64," + screenshot.data;
        image.alt = screenshot.fileName || "Prototype screenshot";
        image.hidden = false;
        status.hidden = true;

        const parts = [];
        if (structured.width && structured.height) parts.push(structured.width + "×" + structured.height);
        if (structured.fileName) parts.push(structured.fileName);
        if (structured.byteSize) parts.push(Math.round(structured.byteSize / 1024) + " KB");
        meta.textContent = parts.join(" · ");
      }

      window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;
        if (message.method === "ui/notifications/tool-result") {
          render(message.params);
        }
      }, { passive: true });

      if (window.openai?.toolOutput || window.openai?.toolResponseMetadata) {
        render({
          structuredContent: window.openai?.toolOutput,
          _meta: window.openai?.toolResponseMetadata?._meta
        });
      }

      let rpcId = 0;
      const id = ++rpcId;
      window.parent.postMessage({
        jsonrpc: "2.0",
        id,
        method: "ui/initialize",
        params: {
          appInfo: { name: "agent-workspace-screenshot-viewer", version: "1.0.0" },
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
