# DEV-017 verification – release readiness

## Goal

Make the current v1 implementation reproducibly reviewable as a release candidate without hiding the deferred DEV-011 Modal OAuth/account-linking feasibility work.

## Current verification baseline

The user has run the verification flows through DEV-016 in the local environment. DEV-001 through DEV-010 and DEV-012 through DEV-016 passed. DEV-011 did not pass and is intentionally deferred for now.

DEV-011 is therefore a known release constraint, not a completed step.

## Automated release-readiness verification

Run:

```bash
npm install
npm run verify:dev017
```

The command runs:

- the complete unit test suite,
- TypeScript typecheck,
- production build,
- MCP contract tests,
- authentication tests,
- security tests,
- deployment/health tests,
- static release-readiness checks.

The static release check verifies that core documentation/deployment artifacts exist, required package scripts are present, the production environment contract is represented in `.env.example`, and DEV-011 is still explicitly recorded as deferred rather than passed.

## Manual release checklist

Before calling the project fully production-release ready:

- confirm the DEV-017 command passes from a clean checkout,
- review README, architecture, functional specification, deployment and security documentation against the actual implementation,
- confirm deployment configuration and secret handling are documented,
- confirm known limitations are explicit,
- resolve and verify DEV-011 before claiming the complete multi-user Modal account-linking flow is production verified.

## DEV-011 exception

Deferring DEV-011 permits continued development and release-candidate preparation. It does not prove the Modal third-party OAuth/account-linking feasibility required by the full multi-user production design.

A release made before DEV-011 is resolved must retain that limitation explicitly.
