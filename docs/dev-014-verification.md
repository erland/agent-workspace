# DEV-014 verification

Status: `verification_pending`

DEV-014 hardens the v1 public/multi-user baseline without adding new product capabilities.

## Implemented controls

- Workspace resource baseline: 1 physical CPU reserved, 2 CPU hard limit, 2048 MiB memory.
- Max workspace lifetime: 20 minutes.
- Max active READY workspaces per user: 3.
- Fixed-window per-user/per-operation rate limiter: 60 operations/minute in the remote server composition.
- Existing ZIP limits retained: 100 MiB compressed, 500 MiB declared uncompressed, 20,000 entries, 1024-char paths, no symlinks/encryption/ZIP64/path traversal.
- MCP base64 archive input is capped before decode and remote HTTP request bodies are capped at 145 MiB.
- Verification and prototype logs remain bounded and are now passed through credential redaction.
- Error normalization redacts bearer/provider-style secrets.
- Modal credentials stay server-side and are not injected into the Sandbox.
- Sandbox creation passes explicit CPU/resource limits and an outbound domain allowlist.
- Periodic expired-workspace cleanup runs in the remote process and cleanup state is persisted even if provider termination reports an error.
- Audit-relevant workspace operations emit structured events without bearer tokens or provider credentials.

## Modal network-policy review

Modal's current JS SDK supports `blockNetwork`, `outboundDomainAllowlist`, `outboundCidrAllowlist`, CPU reservations and CPU hard limits on Sandbox creation. DEV-014 maps the provider-neutral policy onto these fields.

The v1 dependency-domain baseline allows common Debian/Ubuntu package infrastructure, including `archive.ubuntu.com` and `security.ubuntu.com`, plus NodeSource, npm, Maven Central, GitHub-hosted dependency assets and Playwright browser downloads. Custom/private registries are not yet configurable through the public MCP contract.

The live Modal verification must prove that the dependency allowlist is sufficient for the runtime bootstrap and representative npm/Maven builds. If a package legitimately downloads from another domain, the policy must be extended deliberately rather than opening unrestricted egress by default.

## Local verification performed in the ChatGPT environment

Because npm dependency installation times out in this environment, full `npm test/typecheck/build` cannot be claimed here. A provider-neutral compilation/run of the changed core produced:

- DEV-014 hardening tests: 6/6 PASS
- selected regression suites (workspace, npm, Maven, prototype, screenshot + DEV-014): 35/35 tests PASS
- ZIP structure/integrity: pending final packaging check

## Required external verification

On a normal development machine with dependencies available:

```bash
npm install
npm run verify:dev014
```

In addition, run the latest authenticated Modal acceptance path before promoting DEV-014 to fully verified, with particular attention to:

1. runtime bootstrap through the outbound domain allowlist,
2. npm dependency install/build,
3. Maven dependency resolution/build,
4. Chromium/Playwright screenshot,
5. expiry cleanup and sandbox termination.
