# agent-workspace

`agent-workspace` is a provider-neutral workspace service for AI assistants. V1 uses Modal as its only execution provider.

The repository is implemented step-by-step according to `docs/development-plan.md` and `.system-builder/work-status.yaml`.

## Current status

The v1 implementation and local acceptance are complete, and deterministic CI is green. Repository/artifact readiness is **READY_WITH_WARNINGS**.

Full production deployment readiness is **NOT_READY** until DEV-018 deployed settings/personal-credential acceptance, DEV-015 real deployment verification, and DEV-016 remote acceptance against the deployed OAuth-protected MCP endpoint are evidenced. DEV-011 third-party Modal OAuth remains a future onboarding improvement, not a prerequisite for per-user pilot isolation.

See `docs/release-readiness.md` for the canonical readiness decision.

## Authentication and personal Modal credentials

Agent Workspace can act as its own OAuth authorization server for both the remote MCP endpoint and the `/settings` UI. Google is used only as the upstream identity provider. Agent Workspace issues resource-bound access tokens for `/mcp`, so the Google token is never reused as an MCP bearer token.

The flow is:

```text
Google account
    ↓
Agent Workspace /authorize
    ↓
Agent Workspace access/refresh tokens
    ├── /mcp
    └── /settings session
```

The OAuth server publishes RFC 8414 metadata and JWKS, requires PKCE S256, binds access tokens to the MCP resource, rotates one-time refresh tokens, supports Dynamic Client Registration for compatible MCP clients, and can accept Client ID Metadata Documents from explicitly trusted origins.

Pilot users configure their own Modal API Token ID + Token Secret at `/settings`. Modal credential material is verified before the account becomes connected and is stored AES-256-GCM encrypted in PostgreSQL; `execution_account` contains only a `credentialRef`.

Required production settings:

```text
AGENT_WORKSPACE_GOOGLE_CLIENT_ID=...
AGENT_WORKSPACE_GOOGLE_CLIENT_SECRET=...
AGENT_WORKSPACE_AUTH_SIGNING_KEY=...          # Base64 PKCS#8 DER Ed25519 key
AGENT_WORKSPACE_WEB_SESSION_SECRET=...
AGENT_WORKSPACE_CREDENTIAL_ENCRYPTION_KEY=... # Base64, exactly 32 decoded bytes
```

Register `https://<public-host>/auth/google/callback` as the Google OAuth redirect URI.


## DEV-001 development setup

Requirements:

- Node.js 22+
- npm
- Modal authentication for the required live smoke verification

Install dependencies:

```bash
npm ci
```

Run local verification:

```bash
npm test
npm run typecheck
npm run build
```

If you have already authenticated with `modal setup`, the JavaScript SDK can use the active `~/.modal.toml` profile. Then run:

```bash
npm run smoke:modal
```

Alternatively, provide explicit development credentials:

```bash
export MODAL_TOKEN_ID="..."
export MODAL_TOKEN_SECRET="..."
npm run smoke:modal
```

The smoke command creates a Modal sandbox from `node:22-bookworm-slim`, executes `node --version`, and terminates the sandbox in a `finally` block.

For a single DEV-001 verification command after dependencies and Modal authentication are available:

```bash
npm run verify:dev001
```

Modal credentials are consumed only by the application process. They are not passed into the created sandbox.

## Architecture boundary

Core code depends on the provider-neutral `SandboxProvider` interface under `src/core`. Modal SDK code is isolated under `src/providers/modal`.

## DEV-002 – workspace lifecycle

DEV-002 adds process-local workspace lifecycle management and six runtime profiles:
Java 17/21/25 × Node 20/22. The default is Java 21 + Node 22.

Run the required authenticated verification with:

```bash
npm ci
npm run verify:dev002
```

The live smoke creates a logical workspace, verifies that workspace creation does not allocate an execution sandbox, then creates a short-lived execution sandbox to verify Java 21 and Node 22.

## DEV-003 – ZIP upload and validation

DEV-003 validates ZIP archives before they are transferred to the sandbox provider. Default limits are 100 MB compressed, 500 MB declared uncompressed content, 20,000 entries, and 1024 characters per path. Unsafe paths, malformed archives, encrypted entries, symbolic links, multi-disk ZIPs and ZIP64 are rejected in v1.

Run the authenticated end-to-end verification with:

```bash
npm ci
npm run verify:dev003
```

The live smoke stores a validated ZIP in Agent Workspace temporary storage, then verifies that a short-lived Java 21 / Node 22 execution can receive and extract it under `/workspace/project`.


## DEV-004 – project and runtime detection

DEV-004 analyzes the validated ZIP before provider upload and detects Maven/npm manifests and runtime metadata. Java is detected from Maven properties (`maven.compiler.release`, `java.version`, `maven.compiler.source`, `maven.compiler.target`). Node is detected from `.nvmrc`, `.node-version`, Volta, then `engines.node`. Supported runtimes are Java 17/21/25 and Node 20/22; absent or unsupported metadata falls back deterministically to Java 21 / Node 22. A locked workspace is never changed silently; mismatches are returned as warnings.

Run the authenticated combined verification with:

```bash
npm ci
npm run verify:dev004
```

This also exercises the pending DEV-002/DEV-003 live Modal workspace/upload path.

## DEV-005 – npm verification

DEV-005 adds normalized npm project verification with `npm ci`/`npm install`, optional `test` and `build` scripts, command timeouts, bounded logs, and structured failure excerpts.

Authenticated verification:

```bash
npm ci
npm run verify:dev005
```

## DEV-006 Maven verification

Maven projects use the same normalized verification model as npm. `./mvnw` is preferred when present; otherwise system `mvn` is used. Verification runs `test`, which compiles and tests the project. Packaging is handled by `project_build` so verification does not perform duplicate work.

Authenticated verification:

```bash
npm run verify:dev006
```


## Runtime capabilities (DEV-007)

`getCapabilities()` reports the supported v1 runtime matrix without exposing provider-specific image details:

- Java 17, 21, 25 (default 21)
- Node 20, 22 (default 22)
- Maven and npm build systems

Run the authenticated six-profile Modal smoke with:

```bash
npm run verify:dev007
```

Preview hosting and screenshots are delegated to PWA Preview and Browser Screenshot rather than Agent Workspace.

## Lazy execution and temporary artifact storage

A logical Agent Workspace no longer implies a live Modal Sandbox. `workspace_create` creates metadata only and `workspace_upload_zip` persists the validated source ZIP through the provider-neutral `ObjectStore` abstraction. The production v1 store is a Coolify persistent volume mounted at `/data`.

`project_verify` creates a short-lived Sandbox, uploads the stored source, compiles/tests the project, and always terminates the Sandbox in a `finally` block. Maven verification runs `test` only; packaging is performed by `project_build`. `project_build` similarly uses a short-lived Sandbox, publishes detected or explicitly requested outputs to temporary artifact storage, then terminates the Sandbox.

Published build artifacts have independent 60-minute TTL metadata. They can be consumed through `agent-workspace://artifacts/{artifactId}` or through a short-lived signed HTTPS link returned by `artifact_download_link`.

For static web applications, the intended downstream flow is `project_build` → `artifact_download_link` → PWA Preview `preview_create(sourceUrl)`. Screenshots of the resulting public URL belong to Browser Screenshot.

## MCP development server

After `npm ci`, start the local stdio MCP server with:

```bash
npm run mcp:stdio
```

DEV-010 exposes: `get_capabilities`, `get_profile`, `workspace_create`, `workspace_upload_zip`, `workspace_upload_zip_from_url`, `project_verify`, `project_build`, `artifact_get`, `artifact_download_link`, and `workspace_destroy`.


### OpenAI plugin packages

GitHub Releases publish two plugin artifacts:

- `agent-workspace-plugin-<version>.zip` — a ChatGPT update package for the already registered Agent Workspace app. It contains `.app.json` and `.codex-plugin/plugin.json` directly at the ZIP root and is intended to be uploaded as a new version of the existing ChatGPT app.
- `agent-workspace-plugin-desktop-<version>.zip` — the portable Agent Plugins/direct-MCP package with `plugin.json`, `mcp.json`, and the Agent Workspace skill under an `agent-workspace/` top-level directory.

The release build uses the GitHub Actions variables `AGENT_WORKSPACE_CHATGPT_APP_ID` (required), optional `AGENT_WORKSPACE_CHATGPT_PLUGIN_NAME`, and `AGENT_WORKSPACE_MCP_URL`. See [`docs/openai-plugin-distribution.md`](docs/openai-plugin-distribution.md) for the package formats, build commands, release behavior, and configuration.


### ZIP transport across MCP hosts

`workspace_upload_zip` keeps the existing Base64 input as a portable fallback and also declares the optional top-level `archive` input through `_meta["openai/fileParams"]`. ChatGPT can therefore pass an attached file as a temporary download reference without embedding the ZIP bytes in the MCP JSON request.

For MCP hosts that do not support OpenAI file parameters, including Claude-compatible deployments, use `workspace_upload_zip_from_url` with a public HTTPS URL (for example a short-lived presigned object-storage URL). Remote archive downloads are bounded by the same 100 MB compressed archive limit used by ZIP validation. The downloader validates every redirect, rejects credentials in URLs, and rejects localhost, private, link-local and other non-public destinations before fetching.

The provider-neutral workspace layer remains unchanged: every transport is normalized to ZIP bytes before `WorkspaceService.uploadZip()`, so project detection, validation and Modal extraction use the same path regardless of MCP host.

### Static preview and screenshot handoff

Agent Workspace no longer runs interactive web prototypes or captures screenshots. Build a static web output with `project_build`, create a short-lived URL with `artifact_download_link`, and hand that URL to PWA Preview. Use Browser Screenshot against the resulting preview URL when visual verification is needed.

## DEV-011: user-specific Modal accounts

Production design now uses one `ExecutionAccount` per Agent Workspace user. Modal OAuth refresh credentials are resolved server-side from a credential reference and used to construct a dedicated `ModalClient` for that user's operations. See `docs/dev-011-verification.md` for the live two-user feasibility test and the remaining Modal OAuth registration dependency. DEV-011 is currently explicitly deferred; it must be completed before the full multi-user Modal account-linking flow is claimed as production verified.

## DEV-012 persistence

Multi-user metadata is persisted in PostgreSQL from DEV-012. The database stores users, external identities, one execution-account reference per user, and workspace metadata. Provider secret material is not stored in PostgreSQL; only a `credentialRef` is persisted.

For a local persistence smoke test:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
export DATABASE_URL='postgres://agent:agent@localhost:5432/agent_workspace'
npm run verify:dev012
```

## Remote MCP (DEV-013)

`agent-workspace` can run as an OAuth-protected remote MCP resource server. It does not implement its own login/password system or issue OAuth access tokens; configure an external OAuth/OIDC provider.

Required configuration:

```bash
export DATABASE_URL='postgres://...'
export AGENT_WORKSPACE_PUBLIC_BASE_URL='https://workspace.example/'
export AGENT_WORKSPACE_OAUTH_ISSUER='https://login.example/'
export AGENT_WORKSPACE_OAUTH_AUDIENCE='https://workspace.example/mcp'
export AGENT_WORKSPACE_OAUTH_JWKS_URI='https://login.example/.well-known/jwks.json'
export AGENT_WORKSPACE_OAUTH_SCOPE='agent-workspace'

npm run mcp:remote
```

The MCP endpoint is `/mcp`. Protected resource metadata is exposed at:

```text
/.well-known/oauth-protected-resource/mcp
```

A valid token's `iss + sub` pair resolves the Agent Workspace user. Workspaces are always loaded through that user's repository scope, so one authenticated user cannot address another user's workspace by guessing its ID.

The authorization server / identity provider is deliberately external. Selection and production configuration of that provider is required before ChatGPT/Claude acceptance testing.

## DEV-014 security baseline

Public/multi-user v1 now applies a security baseline for untrusted npm/Maven build code: bounded workspace lifetime/resources, maximum active workspaces per user, per-operation rate limiting, bounded/redacted logs, periodic TTL cleanup, structured audit events and a Modal outbound dependency-domain allowlist.

See `docs/security-baseline.md` and `docs/dev-014-verification.md` for the exact controls, known limitations and live verification requirements.

Run the local verification with:

```bash
npm ci
npm run verify:dev014
```

## Coolify deployment (DEV-015)

Production releases publish the application `Dockerfile` as a versioned GHCR image. A GitHub Release tagged, for example, `v1.2.0` publishes:

```text
ghcr.io/erland/agent-workspace:v1.2.0
```

Coolify should deploy that exact immutable release tag rather than rebuilding the repository source. The release tag is also embedded as `AGENT_WORKSPACE_VERSION` in the image.

The deployment uses an external PostgreSQL database. The application host does not run user code and does not need Docker socket, Java, Maven or Chromium.

Health endpoints:

- `GET /health` – liveness
- `GET /ready` – PostgreSQL readiness

See `docs/coolify-deployment.md` for the environment contract and deployment procedure.


## DEV-017 release readiness

Release-candidate preparation is verified with:

```bash
npm ci
npm run verify:dev017
```

The command runs unit tests, typecheck, production build, MCP contract tests, auth/security/deployment tests and static release-readiness checks.

DEV-011 remains a documented exception while Modal third-party OAuth/account-linking feasibility is deferred. This does not block continued release-candidate preparation, but it does block claiming that the complete multi-user production account-linking flow has been verified.

See `docs/dev-017-verification.md` for the release checklist and exact limitation.


## Recommended Coolify topology

Production deployment should expose only Coolify's HTTPS reverse proxy publicly. The Node service listens on container port `3000` and should not use a host mapping such as `3000:3000`.

```text
Internet → Coolify Traefik → Agent Workspace :3000 → external PostgreSQL
```

No Nginx layer is required inside the Agent Workspace container. PostgreSQL is not bundled with the application image; point `DATABASE_URL` at the separate database.


## Prebuilt Modal runtime images

Workspace startup does not install Java, Node or Maven during normal execution; supported build toolchains come from prebuilt runtime images. Six prebuilt runtime images are published to GitHub Container Registry by `.github/workflows/runtime-images.yml`:

```text
java17-node20
java17-node22
java21-node20
java21-node22
java25-node20
java25-node22
```

The published tags follow:

```text
ghcr.io/erland/agent-workspace-runtime:<runtime-profile>-v<runtime-images/version.txt>
```

GitHub Actions publishes these images using the repository `GITHUB_TOKEN`; no Modal credentials are stored in GitHub. The GHCR package must be public so users' separate Modal accounts can resolve it anonymously. After the package is first created, verify its package visibility in GitHub and set it to **Public** if necessary.

Agent Workspace passes the registry reference to Modal with `images.fromRegistry()`. Modal may build/cache its internal immutable Image in each user's Modal context; subsequent sandboxes for that user can reuse the same runtime recipe rather than reinstalling the toolchain.

Runtime image selection can be overridden for forks or staged rollouts:

```text
AGENT_WORKSPACE_RUNTIME_IMAGE_PREFIX=ghcr.io/OWNER/agent-workspace-runtime
AGENT_WORKSPACE_RUNTIME_IMAGE_VERSION=2
```

When the runtime recipe changes, increment `runtime-images/version.txt` and update the application runtime image version in the same change. The runtime-image workflow refuses to publish a tag that already exists in GHCR, so an existing `vN` cannot be repurposed accidentally; publish a new version instead.


## Plugin distribution

See [`docs/openai-plugin-distribution.md`](docs/openai-plugin-distribution.md) for the portable ChatGPT/Codex plugin package and release build.
