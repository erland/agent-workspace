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
    assert.equal(version("runtime-images/version.txt"), "9");
    assert.equal(version("rust-runtime/version.txt"), "1");
    assert.equal(version("tauri-runtime/version.txt"), "1");
  });
});
