import { readFile } from "node:fs/promises";

const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
const failures = [];

if (!/^FROM node:22-/m.test(dockerfile)) failures.push("Dockerfile must use Node 22");
if (/docker\.sock|\/var\/run\/docker/i.test(dockerfile)) failures.push("Docker socket must not be present");
if (/apt(?:-get)?\s+.*(?:openjdk|maven|chromium|playwright)/i.test(dockerfile)) failures.push("App image must not install Java/Maven/Chromium/Playwright");
if (!/HEALTHCHECK/.test(dockerfile) || !/\/health/.test(dockerfile)) failures.push("Dockerfile must healthcheck /health");
if (!/dist\/persistence\/postgres\/migrate\.js/.test(dockerfile)) failures.push("Container must run migrations before start");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("DEV-015 container contract: PASS");
