# DEV-007 verification

## Goal

Verify the complete v1 runtime matrix and capability reporting.

Supported matrix:

- Java 17 + Node 20
- Java 17 + Node 22
- Java 21 + Node 20
- Java 21 + Node 22 (default)
- Java 25 + Node 20
- Java 25 + Node 22

## Provider-neutral verification

Run:

```bash
npm install
npm run test
npm run typecheck
npm run build
```

Capability reporting must expose exactly Java 17/21/25 and Node 20/22, with Java 21 + Node 22 as defaults. Browser/screenshot capabilities remain false until DEV-008/DEV-009 are implemented.

## Authenticated Modal verification

Run:

```bash
npm run smoke:runtime-matrix
```

Or all DEV-007 checks:

```bash
npm run verify:dev007
```

The smoke creates each of the six runtime profiles sequentially, checks `java -version` and `node --version`, and destroys every workspace in a `finally` block.

## Completion rule

DEV-007 is complete only when all six profiles report the expected versions in a real authenticated Modal account.
