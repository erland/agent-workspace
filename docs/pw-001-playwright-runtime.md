# PW-001 – opt-in Playwright Chromium runtime

## Scope

Adds `runtime-images/Dockerfile.playwright`, `playwright-smoke.sh` and a separate `playwright-chromium` CI job. **No changes to the six existing image profiles or project_verify selection** (PW-002). The optional image is published as `ghcr.io/<owner>/agent-workspace-runtime:playwright-chromium-node22-v6` only after smoke and image scan pass. Increment the shared `runtime-images/version.txt` to publish a new complete set of seven images; image tags are immutable.

The optional image inherits Java 21 + Node 22, installs Playwright CLI/package version `1.56.1` with matching Chromium browser assets and OS dependencies into `/opt/ms-playwright`. Smoke uses the same unprivileged `agent-workspace` user as the Modal runtime and launches Chromium headlessly, visits `about:blank`, and evaluates a simple assertion. It does not require an elevated Docker runtime or host socket. Browser sandbox compatibility and Modal resource limits **must still be checked in a real Modal Sandbox**.

## Local/CI acceptance

```bash
docker build -f runtime-images/Dockerfile --build-arg JAVA_VERSION=21 --build-arg NODE_MAJOR=22 -t agent-workspace-runtime:base runtime-images
docker build -f runtime-images/Dockerfile.playwright --build-arg BASE_IMAGE=agent-workspace-runtime:base -t agent-workspace-runtime:playwright-smoke runtime-images
docker run --rm --mount type=bind,source="$(pwd)/runtime-images/playwright-smoke.sh",target=/tmp/playwright-smoke.sh,readonly agent-workspace-runtime:playwright-smoke bash /tmp/playwright-smoke.sh
```

Confirm the CI job `optional-playwright-chromium-node22` passes. Then start a **real Modal Sandbox** with the published image using existing `ModalSandboxProvider` and run `bash /tmp/playwright-smoke.sh` after providing the script inside the sandbox (or execute the equivalent smoke JavaScript). Check successful browser launch, sandbox isolation, memory and timeout, before marking PW-001 fully complete. Existing profile resolution continues to select standard images.

For future PW-002: project `@playwright/test` should match runtime version; use `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`. An explicit version mismatch error is preferable to installing an unexpected browser at runtime.

## Verification state

Static verification only in ZIP delivery environment: Docker daemon and Modal credentials unavailable. Image build, Chromium launch, vulnerability scan, GHCR publish and Modal launch remain **PENDING**. PW-001 is **not marked complete**.

## PW-002: Node and browser verification in one Sandbox

With a workspace created using `playwright: true`, `project_verify` continues to install dependencies and run the project's normal `test` script. If the npm/pnpm project also defines `scripts["test:playwright"]`, it runs that script as a distinct `playwright` verification step, using the same ephemeral Modal Sandbox. A failing browser script fails verification and stops subsequent steps. The existing build script runs after browser tests only when previous steps pass.

Example package.json scripts:

```json
{ "scripts": { "test": "node --test", "test:playwright": "playwright test" }, "devDependencies": { "@playwright/test": "1.56.1" } }
```

For reproducibility, projects should include their own matching Playwright test dependency and lockfile. Browser tests are not auto-run in ordinary Java/Node profiles. Existing `test` scripts that already invoke Playwright should not also define a duplicate `test:playwright` script.

Structured browser reports, screenshots, traces and artifacts are separate follow-up work. Live acceptance in Modal is pending until this change is deployed.

## PW-003: diagnostic artifacts without screenshots

When the explicit `test:playwright` step runs, Agent Workspace automatically attempts to capture these **small text files** before terminating the ephemeral Sandbox:

- `test-results/.last-run.json` (standard Playwright runner run status, if present)
- `playwright-results.json` (Playwright JSON reporter, if configured)

Files are optional. An absent report does not fail verification or appear in `missingCaptureFiles`. Existing per-file size cap (5 MiB) and artifact TTL still apply. Logs, exit codes, failure summaries and step durations remain available in `project_verify` regardless. No screenshots, video or browser traces are collected automatically.

To make detailed test names, locations, errors and retries available on failure, configure the Playwright Test reporter in the project, for example:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
export default defineConfig({ reporter: [['line'], ['json']] });
```

Agent Workspace sets `PLAYWRIGHT_JSON_OUTPUT_NAME=playwright-results.json` for the `test:playwright` step; the JSON reporter only produces this file when the project enables that reporter. The report is returned as a normal `artifacts[]` entry and is readable through `file_read` / `artifact_download_link`. Prefer PWA Preview + Browser Screenshot for visual UI troubleshooting. Avoid putting secrets into test logs or reports.
