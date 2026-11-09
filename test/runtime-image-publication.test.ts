import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";

const workflows = [
  ".github/workflows/runtime-images.yml",
  ".github/workflows/rust-runtime.yml",
  ".github/workflows/tauri-runtime.yml"
] as const;

describe("immutable runtime image publication", () => {
  for (const path of workflows) {
    it(`${path} only publishes on push (not manual validation or schedule)`, () => {
      const yaml = readFileSync(resolve(process.cwd(), path), "utf8");
      const rows = yaml.split(/\r?\n/);
      assert.match(yaml, /workflow_dispatch:/);
      const versionPath = path.includes("rust-runtime") ? "rust-runtime/version.txt"
        : path.includes("tauri-runtime") ? "tauri-runtime/version.txt"
        : "runtime-images/version.txt";
      const pushBlock = yaml.split(/^  push:\s*$/m)[1]?.split(/^permissions:\s*$/m)[0] ?? "";
      assert.match(pushBlock, /branches:\s*\[main\]/);
      assert.ok(pushBlock.includes(`- "${versionPath}"`),
        `${path} must publish only when its version.txt changes`);
      assert.doesNotMatch(pushBlock, /Dockerfile|\.github\/workflows|\/\*\*/);

      assert.match(yaml, /name: Explain manual and scheduled verification mode/);
      assert.doesNotMatch(yaml, /if: github\.event_name != 'pull_request'/);
      assert.doesNotMatch(yaml, /if: github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'/);
      for (let index = 0; index < rows.length; index++) {
        if (/^\s+- name: (?:Refuse overwrite|Refuse overwriting|Publish |Summary$)/.test(rows[index] ?? "")) {
          assert.equal(rows[index + 1]?.trim(), "if: github.event_name == 'push'",
            `${path}:${index + 1} must guard publishing against manual runs and scheduled checks`);
        }
      }
    });
  }

  it("keeps independent Java/Node, Rust and Tauri version files", () => {
    const version = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").trim();
    for (const path of ["runtime-images/version.txt", "rust-runtime/version.txt", "tauri-runtime/version.txt"]) {
      assert.match(version(path), /^[1-9]\\d*$/, `${path} must declare a positive integer image version`);
    }
  });
});
