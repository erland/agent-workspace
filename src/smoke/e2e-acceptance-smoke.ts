import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { makeStoredZip } from "./zip-fixture.js";

const client = new Client({ name: "agent-workspace-dev016-acceptance", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/mcp/stdio.ts"],
  env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
});

const outputDir = resolve("output-dev016");
await mkdir(outputDir, { recursive: true });

try {
  await client.connect(transport);
  await verifyCapabilities();
  await verifyRuntimeSelection();
  await verifyNpm(false);
  await verifyNpm(true);
  await verifyMaven(false);
  await verifyMaven(true);
  await verifyPrototype();
  console.log("DEV-016 pre-deployment MCP acceptance => PASSED");
} finally {
  await client.close();
}

async function verifyCapabilities(): Promise<void> {
  const result = await call("get_capabilities", {});
  const capabilities = result as any;
  const java = capabilities.runtimes?.java?.supported ?? [];
  const node = capabilities.runtimes?.node?.supported ?? [];
  if (JSON.stringify(java) !== JSON.stringify(["17", "21", "25"])) throw new Error(`Unexpected Java capabilities: ${JSON.stringify(java)}`);
  if (JSON.stringify(node) !== JSON.stringify(["20", "22"])) throw new Error(`Unexpected Node capabilities: ${JSON.stringify(node)}`);
  if (capabilities.runtimes?.java?.default !== "21" || capabilities.runtimes?.node?.default !== "22") {
    throw new Error(`Unexpected default runtime: ${JSON.stringify(capabilities.runtimes)}`);
  }
  console.log("capabilities => Java 17/21/25, Node 20/22, defaults 21/22");
}

async function verifyRuntimeSelection(): Promise<void> {
  const workspace = await createWorkspace({ java: "25", node: "20", lifetimeMinutes: 5 });
  try {
    if (workspace.runtimeProfile !== "java25-node20") {
      throw new Error(`Expected java25-node20, got ${workspace.runtimeProfile}`);
    }
    console.log(`runtime selection => ${workspace.runtimeProfile}`);
  } finally {
    await destroyWorkspace(workspace.id);
  }
}

async function verifyNpm(failing: boolean): Promise<void> {
  const workspace = await createWorkspace({ java: "21", node: "22", lifetimeMinutes: 10 });
  try {
    await upload(workspace.id, npmArchive(failing), failing ? "npm-fail.zip" : "npm-pass.zip");
    const result = await call("project_verify", { workspaceId: workspace.id }) as any;
    if (!failing) {
      if (result.status !== "PASSED" || result.projectType !== "NPM") throw new Error(`npm PASS acceptance failed: ${JSON.stringify(result)}`);
      console.log(`npm PASS => ${result.steps?.length ?? 0} steps`);
    } else {
      if (result.status !== "FAILED" || result.failedStep !== "test" || result.exitCode !== 7) {
        throw new Error(`npm FAIL acceptance failed: ${JSON.stringify(result)}`);
      }
      console.log(`npm FAIL => ${result.failedStep}, exit ${result.exitCode}`);
    }
  } finally {
    await destroyWorkspace(workspace.id);
  }
}

async function verifyMaven(failing: boolean): Promise<void> {
  const workspace = await createWorkspace({ java: "21", node: "22", lifetimeMinutes: 10 });
  try {
    await upload(workspace.id, mavenArchive(failing), failing ? "maven-fail.zip" : "maven-pass.zip");
    const result = await call("project_verify", { workspaceId: workspace.id }) as any;
    if (!failing) {
      if (result.status !== "PASSED" || result.projectType !== "MAVEN") throw new Error(`Maven PASS acceptance failed: ${JSON.stringify(result)}`);
      console.log(`Maven PASS => ${result.steps?.length ?? 0} steps`);
    } else {
      if (result.status !== "FAILED" || result.failedStep !== "test" || result.exitCode === 0) {
        throw new Error(`Maven FAIL acceptance failed: ${JSON.stringify(result)}`);
      }
      console.log(`Maven FAIL => ${result.failedStep}, exit ${result.exitCode}`);
    }
  } finally {
    await destroyWorkspace(workspace.id);
  }
}

async function verifyPrototype(): Promise<void> {
  const workspace = await createWorkspace({ java: "21", node: "22", lifetimeMinutes: 10 });
  try {
    await upload(workspace.id, prototypeArchive(), "prototype.zip");
    const started = await call("prototype_start", { workspaceId: workspace.id }) as any;
    if (started.status !== "RUNNING") throw new Error(`prototype_start failed: ${JSON.stringify(started)}`);

    for (const viewport of ["desktop", "tablet", "mobile"] as const) {
      const response = await client.callTool({
        name: "prototype_screenshot",
        arguments: { workspaceId: workspace.id, viewport }
      });
      if (response.isError) throw new Error(firstText(response) ?? `${viewport} screenshot failed`);
      const image = (response.content ?? []).find((part: any) => part?.type === "image") as any;
      if (!image?.data || image.mimeType !== "image/png") throw new Error(`${viewport} did not return PNG image content`);
      const bytes = Buffer.from(image.data, "base64");
      if (bytes.length < 8 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
        throw new Error(`${viewport} returned invalid PNG bytes`);
      }
      const path = resolve(outputDir, `${viewport}.png`);
      await writeFile(path, bytes);
      console.log(`${viewport} screenshot => ${bytes.length} bytes, ${path}`);
    }
  } finally {
    await destroyWorkspace(workspace.id);
  }
}

async function createWorkspace(input: Record<string, unknown>): Promise<any> {
  return call("workspace_create", input);
}

async function destroyWorkspace(workspaceId: string): Promise<void> {
  const result = await call("workspace_destroy", { workspaceId }) as any;
  if (result.status !== "DESTROYED" && result.status !== "EXPIRED") {
    throw new Error(`workspace_destroy returned ${JSON.stringify(result)}`);
  }
  console.log(`cleanup => ${workspaceId} ${result.status}`);
}

async function upload(workspaceId: string, archive: Uint8Array, filename: string): Promise<void> {
  const result = await call("workspace_upload_zip", {
    workspaceId,
    filename,
    archiveBase64: Buffer.from(archive).toString("base64")
  }) as any;
  if (result.workspace?.id !== workspaceId) throw new Error(`Upload did not return expected workspace: ${JSON.stringify(result)}`);
}

async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) throw new Error(firstText(response) ?? `${name} failed`);
  const text = firstText(response);
  if (!text) throw new Error(`${name} returned no text result`);
  const parsed = JSON.parse(text) as { result?: unknown };
  return parsed.result;
}

function firstText(result: { content?: unknown[] }): string | undefined {
  for (const block of result.content ?? []) {
    if (typeof block === "object" && block !== null && (block as any).type === "text") return String((block as any).text);
  }
  return undefined;
}

function npmArchive(failing: boolean): Uint8Array {
  const packageJson = JSON.stringify({
    name: failing ? "acceptance-npm-fail" : "acceptance-npm-pass",
    version: "1.0.0",
    private: true,
    scripts: { test: "node test.js", build: "node build.js" },
    engines: { node: "22" }
  });
  const lockfile = JSON.stringify({
    name: failing ? "acceptance-npm-fail" : "acceptance-npm-pass",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: failing ? "acceptance-npm-fail" : "acceptance-npm-pass", version: "1.0.0" } }
  });
  return makeStoredZip([
    { path: "package.json", content: packageJson },
    { path: "package-lock.json", content: lockfile },
    { path: "test.js", content: failing ? "console.error('intentional acceptance failure'); process.exit(7);\n" : "console.log('acceptance npm test passed');\n" },
    { path: "build.js", content: "require('fs').mkdirSync('dist',{recursive:true}); require('fs').writeFileSync('dist/result.txt','built'); console.log('acceptance npm build passed');\n" }
  ]);
}

function mavenArchive(failing: boolean): Uint8Array {
  const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion><groupId>se.example</groupId><artifactId>acceptance-maven</artifactId><version>1.0.0</version>
  <properties><maven.compiler.release>21</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding><junit.version>5.11.4</junit.version></properties>
  <dependencies><dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>\${junit.version}</version><scope>test</scope></dependency></dependencies>
  <build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version><configuration><release>21</release></configuration></plugin><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.2</version></plugin></plugins></build>
</project>`;
  return makeStoredZip([
    { path: "pom.xml", content: pom },
    { path: "src/main/java/se/example/Calculator.java", content: "package se.example; public class Calculator { public int add(int a,int b){ return a+b; } }\n" },
    { path: "src/test/java/se/example/CalculatorTest.java", content: failing
      ? "package se.example; import org.junit.jupiter.api.Test; import static org.junit.jupiter.api.Assertions.assertEquals; class CalculatorTest { @Test void adds(){ assertEquals(6,new Calculator().add(2,3)); } }\n"
      : "package se.example; import org.junit.jupiter.api.Test; import static org.junit.jupiter.api.Assertions.assertEquals; class CalculatorTest { @Test void adds(){ assertEquals(5,new Calculator().add(2,3)); } }\n" }
  ]);
}

function prototypeArchive(): Uint8Array {
  return makeStoredZip([
    { path: "package.json", content: JSON.stringify({ name: "acceptance-prototype", private: true, scripts: { dev: "vite" }, devDependencies: { vite: "^7.1.0" }, engines: { node: "22" } }) },
    { path: "index.html", content: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font-family:system-ui;background:#f4f6f8;color:#17202a}main{min-height:100vh;display:grid;place-items:center;padding:32px}.card{width:min(900px,100%);background:#fff;padding:clamp(28px,6vw,72px);border-radius:24px}h1{font-size:clamp(36px,7vw,72px);line-height:1;margin:0 0 20px}@media(max-width:600px){main{padding:16px}}</style></head><body><main><section class="card"><h1>Agent Workspace DEV-016</h1><p>End-to-end MCP acceptance prototype.</p></section></main></body></html>` }
  ]);
}
