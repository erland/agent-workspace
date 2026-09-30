import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadModalConfig } from "../config/modal-config.js";
import { ModalSandboxProvider } from "../providers/modal/modal-sandbox-provider.js";
import { WorkspaceService } from "../workspace/workspace-service.js";
import { makeStoredZip } from "./zip-fixture.js";

const config = loadModalConfig();
const provider = new ModalSandboxProvider({
  appName: `${config.appName}-dev009`,
  ...(config.tokenId !== undefined ? { tokenId: config.tokenId } : {}),
  ...(config.tokenSecret !== undefined ? { tokenSecret: config.tokenSecret } : {})
});
const service = new WorkspaceService(provider);

const archive = makeStoredZip([
  {
    path: "package.json",
    content: JSON.stringify({
      name: "agent-workspace-screenshot-smoke",
      private: true,
      scripts: { dev: "vite" },
      devDependencies: { vite: "^7.1.0" }
    })
  },
  {
    path: "index.html",
    content: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>body{font-family:system-ui;margin:0;padding:40px;background:#f4f6f8}main{max-width:900px;margin:auto;background:white;padding:40px;border-radius:24px}h1{font-size:clamp(36px,7vw,72px)}@media(max-width:600px){body{padding:16px}main{padding:24px}}</style></head><body><main><h1>Agent Workspace DEV-009</h1><p>Playwright + Chromium screenshot smoke.</p></main></body></html>`
  }
]);

const outputDir = resolve("output-dev009");
await mkdir(outputDir, { recursive: true });

let workspaceId: string | undefined;
try {
  const workspace = await service.create({ runtime: { java: "21", node: "22" }, lifetimeMinutes: 10 });
  workspaceId = workspace.id;
  console.log(`Workspace ${workspace.id} (${workspace.runtimeProfile})`);
  await service.uploadZip(workspace.id, archive);
  const started = await service.startPrototype(workspace.id);
  if (started.status !== "RUNNING") throw new Error(`Prototype failed: ${started.failureSummary}`);

  for (const viewport of ["desktop", "tablet", "mobile"] as const) {
    const result = await service.screenshotPrototype(workspace.id, viewport);
    if (result.status !== "PASSED") throw new Error(`${viewport} screenshot failed: ${result.failureSummary}`);
    const path = resolve(outputDir, `${viewport}.png`);
    await writeFile(path, result.bytes);
    console.log(`${viewport} => ${result.width}x${result.height}, ${result.bytes.length} bytes, ${path}`);
  }
  console.log("Playwright screenshots => PASSED");
} finally {
  if (workspaceId !== undefined) {
    const destroyed = await service.destroy(workspaceId).catch(() => undefined);
    if (destroyed !== undefined) console.log(`Workspace status => ${destroyed.status}`);
  }
}
