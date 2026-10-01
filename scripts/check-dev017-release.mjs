import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const requiredFiles = [
  "README.md",
  "Dockerfile",
  "package-lock.json",
  ".env.example",
  "docs/functional-specification.md",
  "docs/architecture.md",
  "docs/development-plan.md",
  "docs/security-baseline.md",
  "docs/security-deployment-verification.md",
  "docs/coolify-deployment.md",
  "docs/dev-017-verification.md",
  "docs/release-readiness.md",
  "runtime-images/Dockerfile",
  "runtime-images/version.txt",
  ".github/workflows/runtime-images.yml",
  ".github/workflows/security-scan.yml",
  ".github/workflows/release-image.yml"
];

for (const path of requiredFiles) {
  await access(path, constants.R_OK);
}

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const requiredScripts = [
  "test",
  "typecheck",
  "build",
  "verify:dev010",
  "verify:dev012",
  "verify:dev013",
  "verify:dev014",
  "verify:dev015",
  "verify:dev016",
  "verify:dev017",
  "verify:security-external"
];

for (const name of requiredScripts) {
  if (!pkg.scripts?.[name]) {
    throw new Error(`Missing required package script: ${name}`);
  }
}

const envExample = await readFile(".env.example", "utf8");
for (const name of [
  "DATABASE_URL",
  "AGENT_WORKSPACE_PUBLIC_BASE_URL",
  "AGENT_WORKSPACE_OAUTH_AUDIENCE",
  "AGENT_WORKSPACE_OAUTH_SCOPE",
  "AGENT_WORKSPACE_GOOGLE_CLIENT_ID",
  "AGENT_WORKSPACE_GOOGLE_CLIENT_SECRET",
  "AGENT_WORKSPACE_AUTH_SIGNING_KEY",
  "AGENT_WORKSPACE_WEB_SESSION_SECRET",
  "AGENT_WORKSPACE_CREDENTIAL_ENCRYPTION_KEY"
]) {
  if (!envExample.includes(`${name}=`)) {
    throw new Error(`.env.example is missing ${name}`);
  }
}

const runtimeProfile = await readFile("src/core/runtime-profile.ts", "utf8");
const runtimeVersion = (await readFile("runtime-images/version.txt", "utf8")).trim();
if (!runtimeVersion || !runtimeProfile.includes(`DEFAULT_RUNTIME_IMAGE_VERSION = "${runtimeVersion}"`)) {
  throw new Error("runtime-images/version.txt must match DEFAULT_RUNTIME_IMAGE_VERSION");
}
if (!runtimeProfile.includes("bootstrapCommands: []")) {
  throw new Error("Runtime profiles must not reinstall the fixed toolchain during workspace startup");
}

const runtimeWorkflow = await readFile(".github/workflows/runtime-images.yml", "utf8");
if (!runtimeWorkflow.includes("packages: write")) {
  throw new Error("Runtime image workflow must have packages: write permission");
}
if (runtimeWorkflow.includes("MODAL_TOKEN_ID") || runtimeWorkflow.includes("MODAL_TOKEN_SECRET")) {
  throw new Error("Runtime image workflow must not require Modal credentials");
}

const securityWorkflow = await readFile(".github/workflows/security-scan.yml", "utf8");
for (const required of [
  "npm audit --omit=dev --audit-level=high",
  "aquasecurity/trivy-action@v0.36.0",
  "Application image scan",
  "Default runtime image scan",
  "Runtime image scan java"
]) {
  if (!securityWorkflow.includes(required)) {
    throw new Error(`Security scan workflow is missing required behavior: ${required}`);
  }
}

if (securityWorkflow.includes("ignore-unfixed: true")) {
  throw new Error("Security scan workflow must not globally ignore unfixed vulnerabilities");
}


for (const required of [
  "Refuse overwrite of existing runtime tag",
  "gh api --paginate",
  "metadata.container.tags",
  "Increment runtime-images/version.txt"
]) {
  if (!runtimeWorkflow.includes(required)) {
    throw new Error(`Runtime image workflow is missing immutable-tag protection: ${required}`);
  }
}

const releaseWorkflow = await readFile(".github/workflows/release-image.yml", "utf8");
for (const required of [
  "release:",
  "types: [published]",
  "packages: write",
  "github.event.release.tag_name",
  "ghcr.io/",
  "AGENT_WORKSPACE_VERSION"
]) {
  if (!releaseWorkflow.includes(required)) {
    throw new Error(`Release image workflow is missing required release behavior: ${required}`);
  }
}
if (releaseWorkflow.includes("MODAL_TOKEN_ID") || releaseWorkflow.includes("MODAL_TOKEN_SECRET")) {
  throw new Error("Application release image workflow must not require Modal credentials");
}

const status = await readFile(".system-builder/work-status.yaml", "utf8");
if (!status.includes("id: DEV-011") || !status.includes("verification: DEFERRED")) {
  throw new Error("DEV-011 must be explicitly recorded as DEFERRED while its OAuth feasibility verification is postponed.");
}
if (status.includes("id: DEV-011\n  verification: PASSED")) {
  throw new Error("DEV-011 must not be represented as PASSED.");
}

console.log("DEV-017 release-readiness static checks passed.");
console.log("Note: DEV-011 remains deferred only for Modal third-party OAuth onboarding; DEV-018 external deployment verification remains required for the personal-token pilot path.");
