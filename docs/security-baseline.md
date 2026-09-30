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
