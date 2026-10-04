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
- maximum logical workspace/source/artifact working lifetime 60 minutes,
- maximum interactive Modal prototype Sandbox lifetime 20 minutes; verify/build Sandboxes are terminated immediately after each operation,
- CPU reservation 1 physical core; CPU hard limit 2 cores,
- memory 2048 MiB,
- per-user/per-operation fixed-window rate limit of 60/minute in v1,
- maximum ZIP 100 MiB compressed / 500 MiB declared uncompressed / 20,000 entries,
- remote HTTP payload cap 145 MiB,
- screenshot dimensions capped at 4096×4096 and screenshot output capped at 10 MiB before control-plane readback,
- OAuth Dynamic Client Registration capped at 16 KiB request metadata, 10 redirect URIs, 2048 characters per redirect URI and 20 registrations/minute per service instance,
- command timeouts and bounded logs.

## Temporary storage and artifact handoff

Uploaded source archives, screenshots and build artifacts are copied out of execution Sandboxes into Agent Workspace temporary object storage. The v1 implementation uses a persistent Coolify volume through the provider-neutral ObjectStore interface. Build artifacts have independent expiry metadata and can be read through authenticated MCP resources or short-lived HMAC-signed HTTPS download links. Signed URLs are bounded by artifact expiry and do not contain Modal or Agent Workspace credentials.

## Interactive preview exposure

A running prototype may be exposed through a Modal encrypted HTTPS tunnel on port 4173. The tunnel lifetime is bounded by the same maximum 20-minute Sandbox lifetime. The URL is treated as a temporary public capability: anyone who obtains it can access the prototype until the Sandbox terminates. The preview contains no Agent Workspace or Modal credentials. Only the prototype port is tunneled.

## Network policy

Default Sandbox egress combines a dependency-domain allowlist with an empty CIDR allowlist. Modal's controls are additive: the domain allowlist permits the listed TLS destinations while the empty CIDR allowlist prevents direct-IP/non-domain egress. The baseline includes common npm/Maven/runtime/bootstrap domains. Custom/private package sources require an explicit policy extension.

A live Modal smoke test is included to verify the effective behavior against allowlisted TLS, non-allowlisted TLS, direct public IP, RFC1918 and link-local metadata destinations. That live test requires real Modal credentials and remains external verification until executed.

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

The resource-bound findings have now also been addressed:

- prototype screenshots use viewport capture instead of unbounded full-page capture,
- screenshot artifacts are limited to 10 MiB and size-checked inside the sandbox before bytes are read into the control-plane process,
- `POST /register` is limited to 16 KiB at HTTP intake and in the OAuth handler,
- Dynamic Client Registration accepts at most 10 redirect URIs, each at most 2048 characters, and client names at most 200 characters,
- Dynamic Client Registration has an independent per-instance limit of 20 requests/minute.

The runtime-image hardening finding has now been addressed at the recommended minimum level:

- the publish workflow queries GHCR before build/push and refuses to publish an exact runtime tag that already exists,
- a runtime recipe change therefore requires incrementing `runtime-images/version.txt`,
- GHCR lookup errors fail closed except for package-not-found, so an unavailable registry/API check does not silently permit an overwrite,
- release-readiness checks require the immutable-tag guard to remain present.

Digest pinning remains an optional future strengthening if stronger supply-chain immutability is required.

The repository now also contains automated dependency/container scanning and a deployment-security checklist. During introduction of these scans, additional hardening issues were found and fixed: the runtime image now runs as a non-root user; the application runtime image no longer ships unused npm/corepack/yarn tooling that carried high-severity vulnerabilities; and runtime-image OS/Playwright/npm-toolchain dependencies were updated or patched until the default runtime image passed the high/critical Trivy gate. These runtime recipe changes are published as runtime image version 2.

The Trivy policy is fail-closed for High/Critical findings, including vulnerabilities that do not yet have an upstream fix. Global `ignore-unfixed` suppression is prohibited by the release-readiness check. Removing that suppression surfaced 19 inherited Debian Bookworm vulnerability IDs in the application image; instead of retaining exceptions, the application base image was upgraded to the official Node 22.23.3 Alpine 3.24 image.

One narrowly scoped runtime-image exception is currently active for `CVE-2026-93748` in `http-cache-semantics@4.2.0`. As of 2026-10-04, no upstream fixed version is available. The finding concerns information disclosure through shared HTTP-cache behavior across trust boundaries; Agent Workspace runtime sandboxes are isolated and short-lived and do not provide a shared HTTP cache between users. The exception is restricted to the exact npm package/version PURL, applies only to runtime-image scans, is owned by the repository maintainer, and expires on 2026-11-04. CI validates the exception file and will fail after expiry unless the exception is explicitly reviewed. All other High/Critical findings remain fail-closed.

Two external verification items remain:

- run the live Modal egress smoke with real credentials,
- verify Coolify/PostgreSQL exposure, proxy behavior and secret handling against the deployed environment.

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
runtime-images/version.txt = 2
```

Any runtime-image recipe change must increment that version until stronger immutable-image enforcement is implemented.

## Security remediation sequence

The planned implementation order is:

1. **Workspace lifecycle hardening** – implemented in the current remediation increment: atomic quota reservation, compensating failed creation and stale `CREATING` cleanup.
2. **Resource bounds** – implemented and regression-verified: viewport/byte-bounded screenshots plus OAuth registration request, metadata and rate limits.
3. **Runtime-image hardening** – implemented and statically regression-verified: existing versioned GHCR tags cannot be republished by the workflow.
4. **Security verification** – repository controls implemented and CI-scanned; live Modal egress and deployed Coolify/PostgreSQL verification remain external/pending.

Each increment should keep this document aligned with the controls that are actually implemented and verified, rather than documenting intended protections as if they were already enforced.
