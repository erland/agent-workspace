# DEV-003 verification

DEV-003 adds ZIP upload and validation. The service validates the archive before the provider receives it, then the Modal provider uploads the validated ZIP and extracts it under `/workspace/project`.

## Implemented safety checks

- compressed archive size (default 100 MB),
- declared uncompressed size (default 500 MB),
- entry count (default 20,000),
- path length (default 1024 characters),
- absolute paths and drive-letter paths,
- `..` path traversal,
- local/central filename mismatch,
- malformed/truncated ZIP structures,
- multi-disk archives,
- ZIP64 (explicitly unsupported in v1),
- encrypted entries,
- symbolic-link entries,
- duplicate normalized paths.

## Verification performed in the build environment

- source-level TypeScript compilation of provider-neutral DEV-003 code: PASSED,
- 19 provider-neutral tests: PASSED,
- valid ZIP fixture verified with system `unzip -t`: PASSED,
- Modal JS SDK filesystem API checked against current official documentation: `sandbox.filesystem.writeBytes(data, remotePath)` is supported.

A full `npm install` could not complete in the current restricted environment, so dependency-backed full-project `npm test`, `npm run typecheck`, and `npm run build` remain to be run on the authenticated development machine.

## Required live verification

Run:

```bash
npm install
npm run verify:dev003
```

The `verify:dev003` command runs tests, typecheck and build, then creates a real Modal workspace using the default Java 21 / Node 22 runtime, uploads a valid ZIP, verifies that `/workspace/project/package.json` exists, and destroys the workspace.

A successful DEV-003 smoke also provides the missing live verification for DEV-002's default runtime workspace.


## Re-check while implementing DEV-004

- ZIP package integrity: PASSED (`unzip -t`).
- Provider-neutral source and test transpilation with local TypeScript compiler: PASSED.
- Combined provider-neutral suite after DEV-004: 30 tests passed, 0 failed.
- `npm install` was attempted again but timed out in the restricted environment; live Modal verification remains pending on the authenticated development machine.
