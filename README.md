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

The live smoke creates a real Modal workspace, verifies Java 21 and Node 22, and destroys it.

## DEV-003 – ZIP upload and validation

DEV-003 validates ZIP archives before they are transferred to the sandbox provider. Default limits are 100 MB compressed, 500 MB declared uncompressed content, 20,000 entries, and 1024 characters per path. Unsafe paths, malformed archives, encrypted entries, symbolic links, multi-disk ZIPs and ZIP64 are rejected in v1.

Run the authenticated end-to-end verification with:

```bash
npm ci
npm run verify:dev003
```

The live smoke creates a Java 21 / Node 22 Modal workspace, uploads and extracts a validated ZIP under `/workspace/project`, verifies the extracted file, and destroys the workspace.


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

Maven projects now use the same normalized verification model as npm. `./mvnw` is preferred when present; otherwise system `mvn` is used. Verification runs `test` followed by `package -DskipTests`, with bounded logs and a focused failure excerpt.

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

Browser and screenshot capabilities intentionally remain disabled until the prototype steps are implemented.

## DEV-008 prototype start

An uploaded npm project can now be started as a local web prototype with `WorkspaceService.startPrototype()`. The service installs dependencies, chooses `dev` → `start` → `preview`, starts the process in the sandbox and reports `RUNNING` only after localhost readiness succeeds. Screenshots are added in DEV-009.

## DEV-009 screenshot support

A running prototype can now be captured as PNG through Playwright/Chromium with the `desktop` (1440×900), `tablet` (1024×768), and `mobile` (390×844) presets, stable device profiles, or an explicit viewport up to 4096×4096.

Device profiles are `iphone` (393×852), `iphone-large` (430×932), `ipad` (820×1180), `android` (412×915), and `android-large` (480×1040). They default to `portrait`; `landscape` swaps width and height. These are stable UI viewport profiles rather than claims about one exact hardware model.

`prototype_screenshot` captures exactly one requested viewport. Generic `mobile` or `tablet` requests are not expanded automatically into multiple devices or orientations. Additional portrait/landscape or device variants should only be requested when the user explicitly asks for them. Screenshot bytes stay provider-neutral and are returned as `image/png`; the Modal provider reads the generated PNG through the Sandbox filesystem API.

Run the authenticated live smoke on your Mac with:

```bash
npm ci
npm run verify:dev009
```

Successful live verification writes `output-dev009/desktop.png`, `tablet.png`, and `mobile.png`.

## MCP development server

After `npm ci`, start the local stdio MCP server with:

```bash
npm run mcp:stdio
```

DEV-010 exposes: `get_capabilities`, `get_profile`, `workspace_create`, `workspace_upload_zip`, `workspace_upload_zip_from_url`, `project_verify`, `prototype_start`, `prototype_preview_link`, `prototype_screenshot`, `prototype_screenshot_gallery`, and `workspace_destroy`.

### ZIP transport across MCP hosts

`workspace_upload_zip` keeps the existing Base64 input as a portable fallback and also declares the optional top-level `archive` input through `_meta["openai/fileParams"]`. ChatGPT can therefore pass an attached file as a temporary download reference without embedding the ZIP bytes in the MCP JSON request.

For MCP hosts that do not support OpenAI file parameters, including Claude-compatible deployments, use `workspace_upload_zip_from_url` with a public HTTPS URL (for example a short-lived presigned object-storage URL). Remote archive downloads are bounded by the same 100 MB compressed archive limit used by ZIP validation. The downloader validates every redirect, rejects credentials in URLs, and rejects localhost, private, link-local and other non-public destinations before fetching.

The provider-neutral workspace layer remains unchanged: every transport is normalized to ZIP bytes before `WorkspaceService.uploadZip()`, so project detection, validation and Modal extraction use the same path regardless of MCP host.

### Screenshot return transport

`prototype_screenshot` returns the PNG as a normal inline MCP image block for compatible clients. It deliberately does **not** advertise the screenshot as a `resource_link` in the tool result, because hosts such as ChatGPT may treat returned file resources as materializable attachments and ask the user for an extra approval. The screenshot still has a protected `resourceUri` in structured metadata and remains available through `resources/read` for clients that explicitly need it while the workspace is alive. Screenshot resources remain protected by the same MCP OAuth/user isolation as the workspace and disappear when the sandbox is destroyed.

For ChatGPT and other MCP Apps-compatible hosts, `prototype_screenshot` is capture-only: it returns screenshot metadata plus the resource/image content needed by the model and non-UI clients, but it deliberately has no UI template. This prevents each individual capture from creating its own visible widget.

All visible screenshot presentation goes through `prototype_screenshot_gallery`. The gallery accepts one or more artifact IDs returned by earlier `prototype_screenshot` calls, reads those artifacts server-side, and sends the image data to the widget through tool metadata without returning `resource_link` content blocks. It keeps the selected image as widget state, provides desktop/tablet/mobile-style tabs when several captures are present, and can request ChatGPT fullscreen mode from either the image or the “Open larger” action. This keeps screenshot capture independent from presentation, avoids unnecessary file-materialization prompts, and guarantees one visible gallery widget for the final result.

### Interactive prototype preview

Workspaces now expose the prototype port (4173) through a Modal encrypted HTTPS tunnel. `prototype_start` still starts and verifies the prototype inside the sandbox; `prototype_preview_link` is a separate opt-in tool that returns the clickable tunnel URL only when the user asks to try or interact with the prototype.

The workspace default and maximum lifetime are both 20 minutes. The preview URL is valid only while that sandbox is alive and returns the workspace `expiresAt` timestamp. The tunnel is temporary but public to anyone who has the URL, so the tool result explicitly labels access as `temporary-public`. No Modal credentials, Agent Workspace OAuth tokens or application secrets are embedded in the link.

Vite prototypes bind to `0.0.0.0` when a tunnel is available and receive the exact Modal tunnel hostname through `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`; localhost readiness checks remain unchanged.


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

Public/multi-user v1 now applies a security baseline for untrusted npm/Maven/prototype code: bounded workspace lifetime/resources, maximum active workspaces per user, per-operation rate limiting, bounded/redacted logs, periodic TTL cleanup, structured audit events and a Modal outbound dependency-domain allowlist.

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

Workspace startup does not install Java, Node, Maven, Playwright or Chromium. Six prebuilt runtime images are published to GitHub Container Registry by `.github/workflows/runtime-images.yml`:

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
