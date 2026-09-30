# Release Readiness

## Release candidate

Current source: merged `main` at `d3d55106bee3b393b5390151c2ef6fcbff87aab0`.

This report separates repository/artifact readiness from full production deployment readiness, as required by the System Builder release-readiness standard.

## Scope

The v1 implementation covers:

- provider-neutral workspace lifecycle backed by Modal in v1,
- ZIP upload and validation,
- npm and Maven verification,
- Java 17/21/25 and Node 20/22 runtime profiles,
- prototype start and screenshots,
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
| Local Modal runtime/build/prototype acceptance | yes | PASS | User verification through DEV-016 |
| Reproducible npm dependencies | yes | PASS | committed `package-lock.json`, `npm ci` in CI/Docker |
| Documentation/repository hygiene | yes | PASS | DEV-017 checks + post-merge reconciliation |
| DEV-011 Modal account-linking feasibility | yes for full multi-user production flow | DEFERRED | Requires Modal-issued third-party OAuth integration and two identities |
| DEV-015 real deployment verification | yes for production deployment | PENDING | Clean Coolify-like deployment with PostgreSQL/OAuth/provider connectivity not yet evidenced |
| DEV-016 deployed remote MCP acceptance | yes for production deployment | PENDING | Must run after DEV-015 against deployed OAuth-protected MCP endpoint |

## Acceptance

Local acceptance is green for the implemented execution flows, including npm PASS/FAIL, Maven PASS/FAIL, runtime selection, prototype start, screenshots and cleanup through a real local MCP client and authenticated Modal profile.

This does not constitute final acceptance of the deployed production path.

## Verification evidence

- User reports all local verification commands through DEV-016 passed except DEV-011, which is intentionally deferred.
- `npm run verify:dev017` passed locally.
- GitHub Actions CI passed on merged main commit `d3d55106bee3b393b5390151c2ef6fcbff87aab0`.

## Security / risk

The implemented security baseline includes resource limits, TTL cleanup, rate limiting, ZIP limits, bounded/redacted logs, server-side credential handling, audit events and Modal outbound-domain restrictions.

Production credential lifecycle and account-linking feasibility remain incomplete until DEV-011 is verified.

## Packaging / deployment

The repository includes a production Dockerfile, PostgreSQL startup migration flow, health/readiness endpoints, Coolify deployment documentation and a committed npm lockfile.

Artifact/repository packaging is reproducible.

A real production-like deployment has not yet been evidenced according to DEV-015 completion criteria.

## Documentation

README, functional specification, architecture, development plan, security baseline, deployment documentation and DEV verification documents are present.

Post-merge machine state is reconciled by this closeout change so it no longer claims that the merged work is merely waiting for merge.

## Known limitations

- DEV-011 is intentionally deferred.
- Full production deployment verification is pending.
- Final remote MCP acceptance against the deployed service is pending.

## Blockers

For continued development work: none.

For full production-release readiness:

1. DEV-011 Modal third-party OAuth/account-linking feasibility.
2. DEV-015 deployment verification.
3. DEV-016 deployed remote acceptance.

## Decision

### Repository / artifact readiness: READY_WITH_WARNINGS

The source tree, deterministic CI, local acceptance, packaging and documentation are suitable as a development-complete/release-candidate artifact.

### Full production deployment readiness: NOT_READY

The required DEV-011, DEV-015 and DEV-016 external gates are not all complete. They must not be represented as PASS until actual evidence exists.
