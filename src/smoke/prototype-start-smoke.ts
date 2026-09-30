import { loadModalConfig } from "../config/modal-config.js";
import { ModalSandboxProvider } from "../providers/modal/modal-sandbox-provider.js";
import { WorkspaceService } from "../workspace/workspace-service.js";
import { makeStoredZip } from "./zip-fixture.js";

const config = loadModalConfig();
const provider = new ModalSandboxProvider({
  appName: `${config.appName}-dev008`,
  ...(config.tokenId !== undefined ? { tokenId: config.tokenId } : {}),
  ...(config.tokenSecret !== undefined ? { tokenSecret: config.tokenSecret } : {})
});
const service = new WorkspaceService(provider);

const archive = makeStoredZip([
  {
    path: "package.json",
    content: JSON.stringify({
      name: "agent-workspace-prototype-smoke",
      private: true,
      scripts: { dev: "vite" },
      devDependencies: { vite: "^7.1.0" }
    })
  },
  {
    path: "index.html",
    content: "<!doctype html><html><body><h1>Agent Workspace DEV-008</h1></body></html>"
  }
]);

let workspaceId: string | undefined;
try {
  const workspace = await service.create({ runtime: { java: "21", node: "22" }, lifetimeMinutes: 10 });
  workspaceId = workspace.id;
  console.log(`Workspace ${workspace.id} (${workspace.runtimeProfile})`);
  await service.uploadZip(workspace.id, archive);
  const result = await service.startPrototype(workspace.id);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "RUNNING") {
    throw new Error(`Prototype did not reach RUNNING: ${result.failureSummary}`);
  }
  if (result.url !== "http://127.0.0.1:4173") {
    throw new Error(`Unexpected prototype URL: ${result.url}`);
  }
  console.log("Prototype readiness => PASSED");
} finally {
  if (workspaceId !== undefined) {
    const destroyed = await service.destroy(workspaceId).catch(() => undefined);
    if (destroyed !== undefined) console.log(`Workspace status => ${destroyed.status}`);
  }
}
