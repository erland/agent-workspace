import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const requiredFiles = [
  "README.md",
  "Dockerfile",
  ".env.example",
  "docs/functional-specification.md",
  "docs/architecture.md",
  "docs/development-plan.md",
  "docs/security-baseline.md",
  "docs/coolify-deployment.md",
  "docs/dev-017-verification.md"
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
  "verify:dev017"
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
  "AGENT_WORKSPACE_OAUTH_ISSUER",
  "AGENT_WORKSPACE_OAUTH_AUDIENCE",
  "AGENT_WORKSPACE_OAUTH_JWKS_URI",
  "AGENT_WORKSPACE_OAUTH_SCOPE"
]) {
  if (!envExample.includes(`${name}=`)) {
    throw new Error(`.env.example is missing ${name}`);
  }
}

const status = await readFile(".system-builder/work-status.yaml", "utf8");
if (!status.includes("id: DEV-011") || !status.includes("verification: DEFERRED")) {
  throw new Error("DEV-011 must be explicitly recorded as DEFERRED while its OAuth feasibility verification is postponed.");
}
if (status.includes("id: DEV-011\n  verification: PASSED")) {
  throw new Error("DEV-011 must not be represented as PASSED.");
}

console.log("DEV-017 release-readiness static checks passed.");
console.log("Note: DEV-011 remains deferred and is still required before claiming the complete production account-linking flow is verified.");
