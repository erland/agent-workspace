import { loadModalConfig } from "../config/modal-config.js";
import { RUNTIME_PROFILES, type RuntimeProfileId } from "../core/runtime-profile.js";
import { ModalSandboxProvider } from "../providers/modal/modal-sandbox-provider.js";

const profileIds = Object.keys(RUNTIME_PROFILES).sort() as RuntimeProfileId[];
const config = loadModalConfig(process.env);
const provider = new ModalSandboxProvider({
  appName: `${config.appName}-runtime-matrix`,
  ...(config.tokenId !== undefined ? { tokenId: config.tokenId } : {}),
  ...(config.tokenSecret !== undefined ? { tokenSecret: config.tokenSecret } : {})
});

for (const profileId of profileIds) {
  const expected = RUNTIME_PROFILES[profileId];
  let handle: Awaited<ReturnType<ModalSandboxProvider["createWorkspace"]>> | undefined;

  try {
    console.log(`\n[${profileId}] creating execution sandbox`);
    handle = await provider.createWorkspace({
      imageRef: expected.imageRef,
      timeoutMs: 15 * 60_000
    });

    const java = await provider.exec(handle, { argv: ["java", "-version"], timeoutMs: 30_000 });
    const node = await provider.exec(handle, { argv: ["node", "--version"], timeoutMs: 30_000 });

    const javaText = `${java.stdout}\n${java.stderr}`;
    const nodeText = `${node.stdout}\n${node.stderr}`;

    if (java.exitCode !== 0 || !new RegExp(`(?:version "|openjdk )${expected.java}(?:\\.|")`).test(javaText)) {
      throw new Error(`${profileId}: expected Java ${expected.java}, got: ${javaText.trim()}`);
    }
    if (node.exitCode !== 0 || !new RegExp(`^v${expected.node}\\.`, "m").test(nodeText)) {
      throw new Error(`${profileId}: expected Node ${expected.node}, got: ${nodeText.trim()}`);
    }

    console.log(`[${profileId}] java => ${javaText.trim().split("\n")[0]}`);
    console.log(`[${profileId}] node => ${nodeText.trim()}`);
  } finally {
    if (handle !== undefined) {
      await provider.terminate(handle).catch((error) => {
        console.error(`[${profileId}] cleanup failed`, error);
      });
    }
  }
}

console.log("\nRuntime matrix smoke PASSED");
