# Release Readiness

## Release candidate

Current base: merged `main` at `dda4d2062bf8fc64c67b7f51387fb02bca343d29`. PR #3 adds DEV-018 personal Modal credential settings.

This report separates repository/artifact readiness from full production deployment readiness, as required by the System Builder release-readiness standard.

## Scope

The v1 implementation covers:

- provider-neutral workspace lifecycle backed by Modal in v1,
- ZIP upload and validation,
- npm and Maven verification,
- Java 17/21/25 and Node 20/22 runtime profiles,
- MCP stdio and remote MCP surfaces,
- PostgreSQL persistence,
- OAuth-protected remote resource-server behavior,
- security hardening,
- Docker/Coolify deployment packaging,
- end-to-end local MCP/Modal acceptance.

## Gate summary

| Gate | Required | Result | Evidence |
|---|---|---|---|
| Unit/type/build/contract/security/deployment checks | yes | PASS | GitHub CI on merged main |
| Local Modal runtime/build acceptance | yes | PASS | User verification through DEV-016 and subsequent build-only regression CI |
| Reproducible npm dependencies | yes | PASS | committed `package-lock.json`, `npm ci` in CI/Docker |
| Documentation/repository hygiene | yes | PASS | DEV-017 checks + post-merge reconciliation |
| DEV-011 Modal third-party OAuth onboarding | no for personal-token pilot; yes only for third-party OAuth claim | DEFERRED | Personal API tokens now provide per-user Modal isolation; Modal-issued OAuth integration is still unavailable |
| DEV-018 shared auth + personal Modal credential settings | yes for production pilot | PENDING_EXTERNAL | Shared Google-backed Agent Workspace OAuth server and encrypted personal Modal credentials are implemented; GitHub Actions run 36762061458 is green, while deployed MCP OAuth/settings/two-user Modal acceptance is not yet evidenced |
| DEV-015 real deployment verification | yes for production deployment | PENDING | Clean Coolify-like deployment with PostgreSQL/OAuth/provider connectivity not yet evidenced |
| DEV-016 deployed remote MCP acceptance | yes for production deployment | PENDING | Must run after DEV-015 against deployed OAuth-protected MCP endpoint |

## Acceptance

Local acceptance is green for the retained execution flows, including npm PASS/FAIL, Maven PASS/FAIL, runtime selection, build/artifact handling and cleanup through the MCP path. Historical prototype/screenshot acceptance is no longer part of the current Agent Workspace release surface.

This does not constitute final acceptance of the deployed production path.

## Verification evidence

- User reports all local verification commands through DEV-016 passed except DEV-011, which is intentionally deferred.
- `npm run verify:dev017` passed locally.
- GitHub Actions CI passed on merged main commit `d3d55106bee3b393b5390151c2ef6fcbff87aab0`.

## Security / risk

The implemented security baseline includes resource limits, TTL cleanup, rate limiting, ZIP limits, bounded/redacted logs, server-side credential handling, audit events and Modal outbound-domain restrictions.

Personal Modal credentials are encrypted at rest behind the credential-store abstraction. Agent Workspace now also implements the shared OAuth authorization server for MCP and settings with Google as upstream identity. Production acceptance still requires DEV-018 deployed Google/MCP OAuth/settings verification. DEV-011 only blocks claiming third-party Modal OAuth onboarding, not per-user Modal isolation through personal API tokens.

## Packaging / deployment

The repository includes a production Dockerfile, PostgreSQL startup migration flow, health/readiness endpoints, Coolify deployment documentation and a committed npm lockfile.

Artifact/repository packaging is reproducible.

A real production-like deployment has not yet been evidenced according to DEV-015 completion criteria.

## Documentation

README, functional specification, architecture, development plan, security baseline, deployment documentation and DEV verification documents are present.

Post-merge machine state is reconciled by this closeout change so it no longer claims that the merged work is merely waiting for merge.

## Known limitations

- DEV-011 third-party Modal OAuth onboarding is intentionally deferred; manual creation of a personal Modal API token is still required.
- DEV-018 deployed settings/personal-token acceptance is pending.
- Full production deployment verification is pending.
- Final remote MCP acceptance against the deployed service is pending.

## Blockers

For continued development work: none.

For full production-release readiness:

1. DEV-018 deployed OIDC/settings/personal Modal credential acceptance.
2. DEV-015 deployment verification.
3. DEV-016 deployed remote acceptance.

DEV-011 is not a blocker for the personal-token pilot path; it remains required only before claiming automated third-party Modal OAuth account linking.

## Decision

### Repository / artifact readiness: READY_WITH_WARNINGS

The source tree, deterministic CI, local acceptance, packaging and documentation are suitable as a development-complete/release-candidate artifact.

### Full production deployment readiness: NOT_READY

The required DEV-018, DEV-015 and DEV-016 external gates are not all complete. They must not be represented as PASS until actual evidence exists. DEV-011 remains deferred for automated Modal OAuth onboarding.
