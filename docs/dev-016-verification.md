# DEV-016 verification

Status: **implementation complete, pre-deployment acceptance pending live Modal execution**.

DEV-016 adds a real MCP-client acceptance harness that can be run locally without deploying Agent Workspace to Coolify first. It launches the existing stdio MCP server and verifies the functional execution path against the authenticated local Modal profile.

The harness covers:

1. capability/default runtime reporting,
2. explicit Java 25 + Node 20 runtime selection,
3. npm PASS,
4. npm normalized FAIL,
5. Maven PASS,
6. Maven normalized FAIL,
7. prototype start,
8. desktop/tablet/mobile PNG screenshots returned as MCP image content,
9. explicit workspace cleanup in `finally` for every case.

Run on a machine where `modal setup` has already been completed:

```bash
npm install
npm run verify:dev016
```

Screenshots are written to `output-dev016/`.

## Deployment boundary

This local acceptance harness intentionally does **not** prove the final production path through Coolify, PostgreSQL and a real external OAuth/OIDC issuer. Therefore DEV-016 must remain `verification_pending` until either:

- the local MCP/Modal acceptance is green and DEV-015 deployment verification is green, followed by a remote MCP acceptance against the deployed service, or
- the development plan is explicitly revised to accept local MCP acceptance as the DEV-016 completion criterion.
