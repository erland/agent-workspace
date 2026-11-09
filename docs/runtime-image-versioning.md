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

## MCP runtime selection and authenticated workspace creation

All runtimes now use the **single** `workspace_create` MCP tool. It accepts `java`, `node`, `playwright`, `rust`, `tauri` and `lifetimeMinutes`, and validates incompatible combinations. No `workspace_create_rust` alias is needed.

**Root cause from production validation (2026-11-09):** The primary MCP schema and local `AgentWorkspaceToolService` already forwarded `rust:true` and `tauri:true`, but the **authenticated production service** (`AuthenticatedAgentWorkspaceToolService.createWorkspace`) still only forwarded `java`, `node`, and `playwright`. Both `workspace_create({rust:true})` and the temporary `workspace_create_rust` alias therefore created `java21-node22` workspaces. The separate alias was based on a mistaken initial diagnosis of stale cached ChatGPT schema and has been removed.

The authenticated service now forwards both Rust and Tauri options. Regression tests exercise that same authenticated service with a connected execution account and check both the returned and persisted `runtimeProfile` for Rust and Tauri, plus incompatible profile selections. MCP smoke verifies that `workspace_create` advertises both options in the actual `tools/list` response.

After deploying this change, **refresh the MCP tools in ChatGPT** so the obsolete `workspace_create_rust` tool disappears. Then run a real Cargo project by `workspace_create({rust:true})`, `workspace_upload_zip`, `project_verify` (Cargo format, check, Clippy, unit tests) and `workspace_destroy`. The remaining live acceptance requires a deployment of the server code but **no new runtime image version**.
