# Runtime image versioning and publication

All runtime images live in the GHCR container package `ghcr.io/erland/agent-workspace-runtime`, but their versions are **independent release streams**:

| Profiles | Tag suffix | Version file | Runtime env override | Default |
| --- | --- | --- | --- | --- |
| Six Java/Node combinations | `java21-node22-v9` etc. | `runtime-images/version.txt` | `AGENT_WORKSPACE_RUNTIME_IMAGE_VERSION` | `9` |
| Playwright | `playwright-chromium-node22-v9` | `runtime-images/version.txt` | `AGENT_WORKSPACE_RUNTIME_IMAGE_VERSION` | `9` |
| Rust | `rust-v1` | `rust-runtime/version.txt` | `AGENT_WORKSPACE_RUST_RUNTIME_IMAGE_VERSION` | `1` |
| Tauri | `tauri-linux-v1` | `tauri-runtime/version.txt` | `AGENT_WORKSPACE_TAURI_RUNTIME_IMAGE_VERSION` | `1` |

`AGENT_WORKSPACE_RUNTIME_IMAGE_PREFIX` applies to every profile; it changes the repository path, not any version.

**Production example:** Keep `AGENT_WORKSPACE_RUNTIME_IMAGE_VERSION=9` for Java/Node and Playwright; leaving the two new variables unset uses `rust-v1` and `tauri-linux-v1`. Setting the shared variable to `1` would make the seven original profiles point at nonexistent/obsolete version 1 tags.

## Running GitHub Actions

- **Pull request:** Build, smoke-test, scan. Never publish.
- **Run workflow (manual):** Build, smoke-test, scan. Never publish or attempt to overwrite existing tags.
- **Tauri weekly schedule:** Build and scan Ubuntu patch status. Never publish.
- **Push to main that changes the corresponding `version.txt`:** Build, smoke-test and scan, then check for an existing immutable tag. If a changed image must be published, **increment its own version.txt before merge**. Workflow-only or Dockerfile-only changes do not automatically publish on merge; PR validation still runs for those changes. A tag that already exists still blocks publication; this avoids silently replacing a production image.

The existing version check is deliberately strict. A repeated manual verification of `tauri-linux-v1` must NOT be treated as a new image release. The failure in GitHub Actions run [42607790377](https://github.com/erland/agent-workspace/actions/runs/42607790377) occurred because the previous workflow tried to publish that existing tag again.

A **GitHub Release of Agent Workspace** is distinct from publishing a runtime container image. A code release should not require updating every runtime image version. Rebuilding a changed Tauri or Rust image requires a version increment only for that image and, if needed, updating the corresponding production override.

The current Tauri profile is still **build-only/headless** while the documented WebKitGTK CVE-2026-3909 risk acceptance is active. The existing expiry checks and raw Trivy evidence are unchanged by this workflow fix.

## MCP schema refresh after adding Rust/Tauri profiles

The deployed Agent Workspace server already declares `workspace_create({ rust: true })` and `workspace_create({ tauri: true })` in `WorkspaceCreateInputSchema`. However, ChatGPT or another MCP client may retain an **older tools/list schema** containing only `java`, `node`, `playwright` and `lifetimeMinutes`. This is a client-side cached tool definition; `get_capabilities` can advertise Cargo and Rust even when the cached `workspace_create` schema prevents sending `rust:true`.

For compatibility, the server now additionally exposes `workspace_create_rust({ lifetimeMinutes?: number })`. This creates precisely a Rust-profile workspace by forwarding `rust: true` internally. The original `workspace_create` remains unchanged and supports Rust and Tauri as optional parameters. The MCP smoke checks that **the advertised tools/list input schema itself** includes both options.

**Required after deployment:** In ChatGPT, refresh/reload the Agent Workspace connection's tools (or reconnect the plugin if its tool schema is not refreshed). Then verify that either `workspace_create` accepts `rust:true` or the newly introduced `workspace_create_rust` tool is listed. If neither is visible, the ChatGPT connection is still using a cached schema or older deployed endpoint; redeployment alone cannot mutate an already-cached client tool definition.

For live acceptance, create a temporary Rust workspace using one of the two routes, upload a ZIP with `Cargo.toml` and a real unit test, run `project_verify`, confirm Cargo fmt/check/Clippy/tests all pass, and destroy the workspace. No runtime image bump is required for this server-side MCP tool change.
