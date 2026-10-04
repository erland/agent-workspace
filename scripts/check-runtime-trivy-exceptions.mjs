import { readFile } from "node:fs/promises";

const path = "security/trivy-runtime-ignore.yaml";
const content = await readFile(path, "utf8");

const expectedId = "CVE-2026-93748";
const expectedPurl = "pkg:npm/http-cache-semantics@4.2.0";

if (!content.includes(`id: ${expectedId}`)) {
  throw new Error(`Runtime Trivy exception must contain only the reviewed vulnerability ${expectedId}`);
}
if (!content.includes(expectedPurl)) {
  throw new Error(`Runtime Trivy exception must stay scoped to ${expectedPurl}`);
}

const ids = [...content.matchAll(/^\s*-?\s*id:\s*(\S+)\s*$/gm)].map((match) => match[1]);
if (ids.length !== 1 || ids[0] !== expectedId) {
  throw new Error("Runtime Trivy exception file must contain exactly one vulnerability ID");
}

const expiryMatch = content.match(/^\s*expired_at:\s*(\d{4}-\d{2}-\d{2})\s*$/m);
if (!expiryMatch) {
  throw new Error("Runtime Trivy exception must have an explicit expired_at date");
}

const expiry = new Date(`${expiryMatch[1]}T00:00:00Z`);
const now = new Date();
if (Number.isNaN(expiry.getTime())) {
  throw new Error("Runtime Trivy exception expiry date is invalid");
}
if (now >= expiry) {
  throw new Error(
    `Runtime Trivy exception for ${expectedId} expired on ${expiryMatch[1]}; review upstream status and remove or explicitly renew it`
  );
}

if (!content.includes("Owner: repository maintainer")) {
  throw new Error("Runtime Trivy exception must record an owner");
}

console.log(`Runtime Trivy exception is narrowly scoped and valid until ${expiryMatch[1]}`);
