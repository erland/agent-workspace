# agent-workspace

`agent-workspace` is a provider-neutral workspace service for AI assistants. V1 uses Modal as its only execution provider.

The repository is implemented step-by-step according to `docs/development-plan.md` and `.system-builder/work-status.yaml`.

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

A running prototype can now be captured as PNG through Playwright/Chromium with the `desktop` (1440×900), `tablet` (1024×768), and `mobile` (390×844) presets or an explicit viewport up to 4096×4096. Screenshot bytes stay provider-neutral and are returned as `image/png`; the Modal provider reads the generated PNG through the Sandbox filesystem API.

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

DEV-010 exposes: `get_capabilities`, `get_profile`, `workspace_create`, `workspace_upload_zip`, `project_verify`, `prototype_start`, `prototype_screenshot`, and `workspace_destroy`.

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

Production deployment uses the repository `Dockerfile` and an external PostgreSQL database. The application host does not run user code and does not need Docker socket, Java, Maven or Chromium.

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
