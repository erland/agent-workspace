import assert from "node:assert/strict";
import test from "node:test";
import { selectNodePackageManager } from "../src/project/node-package-manager.js";

test("defaults to npm with package-lock or no lockfile", () => {
  assert.deepEqual(selectNodePackageManager({hasPackageLock:true}).install, ["npm","ci","--no-audit","--no-fund"]);
  assert.deepEqual(selectNodePackageManager({}).install, ["npm","install","--no-audit","--no-fund"]);
});

test("selects pnpm from lockfile or packageManager and preserves lock integrity", () => {
  const detected = selectNodePackageManager({hasPnpmLock:true});
  assert.deepEqual(detected.install, ["pnpm","install","--frozen-lockfile"]);
  assert.deepEqual(detected.test, ["pnpm","test"]);
  assert.deepEqual(detected.build, ["pnpm","run","build"]);
  assert.deepEqual(selectNodePackageManager({packageManager:"pnpm@10.34.5"}).install, ["pnpm","install","--no-frozen-lockfile"]);
});

test("manifest declaration takes priority over lockfile", () => {
  assert.equal(selectNodePackageManager({packageManager:"npm@11.21.0",hasPnpmLock:true}).manager, "npm");
});

test("unsupported managers or conflicting locks fail explicitly", () => {
  assert.throws(() => selectNodePackageManager({packageManager:"yarn@4.0.0"}), /Unsupported/);
  assert.throws(() => selectNodePackageManager({packageManager:"pnpm@10.34.5",hasPackageLock:true}), /missing/);
});
