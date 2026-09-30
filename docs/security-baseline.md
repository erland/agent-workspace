# Security baseline – v1

`agent-workspace` treats every uploaded ZIP and every build/prototype process as untrusted code.

## Trust boundaries

- ChatGPT/Claude/MCP clients authenticate to `agent-workspace`; their bearer token stays on the server side.
- Modal execution credentials are resolved server-side from an opaque `credentialRef` and are never injected into a Sandbox.
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
