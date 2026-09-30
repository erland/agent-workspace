# DEV-004 verification

## Implemented

- Maven/npm project detection from ZIP metadata.
- Java detection from `maven.compiler.release`, `java.version`, `maven.compiler.source`, and `maven.compiler.target`, including simple `${property}` resolution.
- Node detection from `.nvmrc`, `.node-version`, `package.json` Volta, and `engines.node`.
- Supported runtime reporting for Java 17/21/25 and Node 20/22.
- Deterministic defaults Java 21 / Node 22 when metadata is absent or unsupported.
- Runtime mismatch warnings against the locked workspace profile.
- Ambiguous manifest and unsupported runtime warnings.

## Local verification

Run provider-neutral tests plus type/build where dependencies are available. The live Modal command remains `npm run verify:dev004`; it reuses the upload smoke so DEV-002/003 live verification is also exercised.

## Verification performed here

- Source + tests transpiled with TypeScript 5.8 using `--noCheck`: PASSED.
- Provider-neutral Node test run from emitted JavaScript: 30 tests passed, 0 failed.
- DEV-004-specific project/runtime tests: 8 passed.
- `npm install --ignore-scripts --no-audit --no-fund` was attempted but timed out in the restricted environment, so dependency-backed `npm test`, `npm run typecheck`, `npm run build` and live Modal smoke remain for the authenticated Mac.
