# DEV-016 regression fix 1

This maintenance patch addresses the TypeScript regressions found when running `npm run verify:dev001` against the accumulated DEV-016 codebase.

Fixed areas:

- Removed explicit `HeadersInit` references from Node-only server/smoke code.
- Added explicit schema-derived input typing at MCP tool registration boundaries.
- Normalized optional screenshot viewport input for `exactOptionalPropertyTypes`.
- Typed the health test JSON body.
- Updated verifier/provider test doubles to implement `SandboxProvider.readFile`.
- Broadened the project-detector test helper to accept every `RuntimeProfileId`.

No product behavior or public MCP tool contract is intentionally changed by this patch.

## Verification status

The user-reported baseline before this patch was 89/89 tests passing followed by 25 TypeScript errors in 9 files during `tsc --noEmit`. The patch directly addresses each reported error category. Full dependency-backed `npm test`, `npm run typecheck`, and `npm run build` must be rerun on a machine where dependencies can be installed; dependency installation times out in the current execution environment.
