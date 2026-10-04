# Security deployment verification

This checklist captures the security controls that cannot be proven from the repository alone. It is intentionally separate from the deterministic CI baseline.

## Status

**Overall status: EXTERNAL_VERIFICATION_PENDING**

Repository-level controls and automated scans can pass without proving the live Coolify/PostgreSQL/Modal environment is configured safely.

## Modal egress verification

The default Agent Workspace policy now combines:

- an explicit dependency-domain allowlist, and
- an empty CIDR allowlist.

Modal documents these controls as additive. The empty CIDR allowlist blocks direct IP/non-domain egress while the domain allowlist permits the listed TLS destinations.

Run:

```bash
npm run verify:security-external
```

with valid Modal credentials.

The live smoke must prove:

- `https://registry.npmjs.org/` is reachable,
- a non-allowlisted TLS domain is blocked,
- direct public-IP access is blocked,
- RFC1918/private-IP access is blocked,
- link-local metadata access (`169.254.169.254`) is blocked,
- the sandbox is terminated after the test.

Do not mark Modal egress verified based only on unit tests or SDK configuration mapping.

## Coolify / reverse proxy

Verify in the deployed environment:

- [ ] Only the public HTTPS reverse proxy is exposed.
- [ ] Application port `3000` has no host-port mapping.
- [ ] TLS is valid and HTTP redirects to HTTPS where appropriate.
- [ ] Proxy forwarding is controlled by the deployment platform; untrusted clients cannot bypass the proxy path.
- [ ] No Docker socket is mounted into the application container.
- [ ] The application image is deployed from an explicit release tag.
- [ ] `/health` and `/ready` behave as documented.
- [ ] Logs do not contain OAuth bearer/refresh tokens, Modal token secrets, database passwords, session secrets or credential-encryption keys.

## PostgreSQL

Verify:

- [ ] PostgreSQL is not exposed publicly unless explicitly required and separately protected.
- [ ] The Agent Workspace database user has only the privileges needed for schema migration and application data access.
- [ ] TLS is used for remote database transport where the provider supports it.
- [ ] Backups are enabled and restore procedure is known.
- [ ] `DATABASE_URL` is injected as a secret and is not baked into an image.
- [ ] Database logs/backups are access-controlled.

## OAuth / settings / secrets

Verify:

- [ ] Google callback URL exactly matches the deployed HTTPS origin.
- [ ] Private signing key and web-session secret are injected as secrets.
- [ ] Credential encryption key is backed up/managed so stored Modal credentials remain decryptable.
- [ ] Allowlist behavior is verified with both allowed and denied identities.
- [ ] Refresh-token rotation is verified through the deployed endpoint.
- [ ] Service restart preserves expected settings/session/account behavior.

## Dependency and container scanning

The repository security workflow performs:

- production `npm audit` at high/critical threshold,
- optional GitHub Dependency Review once Dependency Graph is enabled for the repository,
- Trivy repository vulnerability/misconfiguration/secret scan,
- Trivy application-image scan,
- Trivy default runtime-image scan on normal CI events,
- full six-profile runtime-image matrix scan weekly and on manual dispatch.

High/critical findings fail the security workflow whether or not an upstream fix is currently available. The workflow must not use Trivy's global `ignore-unfixed` behavior. Temporary exceptions must be narrowly scoped to explicit vulnerability IDs with rationale/owner and an expiry/review date.

The current baseline contains exactly one such exception: `CVE-2026-93748` for `pkg:npm/http-cache-semantics@4.2.0`, used only by runtime-image scans. It expires on 2026-11-04. `scripts/check-runtime-trivy-exceptions.mjs` verifies that the exception file contains only that reviewed CVE/package scope, records an owner, and has not expired. The application image and repository scans do not use the runtime ignore file.

## Completion criteria

This verification step is complete only when:

1. normal CI is green,
2. the security scan workflow is green,
3. the live Modal egress smoke passes with real credentials,
4. the Coolify/PostgreSQL checklist above has been verified against the deployed environment.

Until 3 and 4 are complete, repository hardening may be merged, but production security verification remains pending.
