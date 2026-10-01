# Security baseline – v1

`agent-workspace` treats every uploaded ZIP and every build/prototype process as untrusted code.

## Trust boundaries

- Google authenticates the human identity only. Google access/ID tokens are never accepted as MCP bearer tokens.
- Agent Workspace acts as the OAuth authorization server for MCP and issues its own short-lived, resource-bound Ed25519 JWT access tokens.
- OAuth authorization codes and refresh tokens are opaque, stored only as SHA-256 hashes, and consumed once; refresh tokens rotate on use.
- Authorization Code requires PKCE S256. MCP access tokens are audience-bound to the exact `/mcp` resource.
- Dynamic Client Registration creates public clients only (`token_endpoint_auth_method=none`); Client ID Metadata Documents are fetched only from explicitly trusted HTTPS origins.
- The settings session is signed, HttpOnly, Secure and SameSite=Lax; state/nonce and CSRF protections are separate.
- Modal execution credentials are resolved server-side from an opaque `credentialRef` and are never injected into a Sandbox. Personal Modal API credentials are AES-256-GCM encrypted at rest.
- Uploaded project code receives no application database credentials, OAuth refresh tokens, provider credentials or server environment by design.
- A Sandbox is disposable and bounded by lifetime, CPU, memory and network policy.

## Resource and abuse controls

- maximum 3 active workspaces per user,
- maximum workspace lifetime 60 minutes,
- CPU reservation 1 physical core; CPU hard limit 2 cores,
- memory 2048 MiB,
- per-user/per-operation fixed-window rate limit of 60/minute in v1,
- maximum ZIP 100 MiB compressed / 500 MiB declared uncompressed / 20,000 entries,
- remote HTTP payload cap 145 MiB,
- screenshot dimensions capped at 4096×4096,
- command timeouts and bounded logs.

## Network policy

Default Sandbox egress uses a dependency-domain allowlist. It is intentionally not a general unrestricted Internet environment. The baseline includes common npm/Maven/runtime/bootstrap domains. Custom/private package sources require a future explicit policy extension.

Modal exposes both outbound domain and CIDR controls. DEV-014 uses the domain allowlist at Sandbox creation. A later hardening increment may add a reviewed public-CIDR policy if live testing shows it is needed to prevent direct-IP egress while preserving dependency resolution.

## Logging and audit

Build/prototype output is bounded and redacted for common bearer/provider credential patterns. Audit events contain identifiers, action, outcome and error code only; they do not contain access tokens, refresh tokens or Modal credential material.

## Cleanup

Workspace TTL is enforced both by timers and persisted expiry metadata. The remote process periodically scans persisted READY workspaces whose TTL has elapsed. Cleanup persists `EXPIRED` even when a provider termination call reports an error, so abandoned state remains visible and cannot silently stay READY.

## Security review baseline – 2026-10-01

A focused security review of the current implementation identified no verified critical or high-severity findings. The workspace lifecycle findings have now been addressed:

- per-user workspace capacity is reserved atomically and both `CREATING` and `READY` consume quota,
- PostgreSQL serializes same-user reservations with a transaction-scoped advisory lock around the atomic count+insert statement,
- any failure after provider allocation attempts to terminate the sandbox and a reserved workspace is moved to `DESTROYED`,
- stale `CREATING` reservations are included in expiry cleanup so a crashed creator cannot consume quota indefinitely,
- the expiry timer is installed only after the workspace has successfully reached `READY`.

The following hardening items remain open for later security increments:

1. Add dedicated resource limits and abuse controls to unauthenticated OAuth Dynamic Client Registration at `POST /register`.
2. Add a hard screenshot byte-size bound in addition to the current viewport bounds, preferably preventing oversized artifacts before they are read into the control-plane process and base64 encoded.
3. Prevent accidental replacement of an existing versioned runtime-image tag; consider digest pinning later if stronger supply-chain immutability is required.

The review also left three verification items that are not treated as confirmed code defects:

- verify with a live Modal sandbox that the configured domain allowlist also prevents unwanted direct-IP/private-network/metadata endpoint egress,
- verify Coolify/PostgreSQL exposure, trusted proxy behavior and secret handling in the deployed environment,
- run current dependency and container-image vulnerability checks as part of release/security verification.

The existing PKCE flow, resource/audience binding, settings CSRF protection, AES-256-GCM credential storage, workspace ownership filtering and ZIP validation are not targeted for redesign by this remediation plan.

## Regression verification baseline

Before and after each security-hardening increment, the deterministic repository baseline is:

```bash
npm ci --no-audit --no-fund
npm test
npm run typecheck
npm run build
npm run test:mcp-contract
npm run test:auth
npm run test:security
npm run test:deployment
npm run check:release
```

This is the same deterministic set exercised by the repository CI workflow on pushes and pull requests.

Live Modal smoke tests remain environment-dependent and are run only when appropriate credentials and an execution account are available. They are required for changes whose acceptance criterion depends on real Modal behavior, especially network-policy verification.

The runtime-image baseline at the time of this review is:

```text
runtime-images/version.txt = 1
```

Any runtime-image recipe change must increment that version until stronger immutable-image enforcement is implemented.

## Security remediation sequence

The planned implementation order is:

1. **Workspace lifecycle hardening** – implemented in the current remediation increment: atomic quota reservation, compensating failed creation and stale `CREATING` cleanup.
2. **Resource bounds** – **in progress**: screenshot byte limits plus OAuth registration metadata/rate limits.
3. **Runtime-image hardening** – prevent reuse/overwrite of an existing runtime-image version.
4. **Security verification** – live Modal egress checks, deployment verification and dependency/container scanning.

Each increment should keep this document aligned with the controls that are actually implemented and verified, rather than documenting intended protections as if they were already enforced.
