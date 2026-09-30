# DEV-002 verification

## Scope

Workspace lifecycle and runtime profiles only. ZIP upload, project detection and build logic remain outside DEV-002.

## Runtime profiles

- Java 17 + Node 20
- Java 17 + Node 22
- Java 21 + Node 20
- Java 21 + Node 22 (default)
- Java 25 + Node 20
- Java 25 + Node 22

For the first implementation each profile starts from the matching `eclipse-temurin:<java>-jdk-noble` registry image and runs a provider-controlled bootstrap that installs Maven and the selected Node major version through NodeSource. This favors correctness and low implementation complexity over startup speed. A later optimization may replace the bootstrap with published prebuilt Modal Images without changing the workspace API.

## Required local verification

On a machine with npm registry access and an authenticated Modal profile:

```bash
npm install
npm run verify:dev002
```

Required result:

1. all unit tests pass,
2. TypeScript typecheck passes,
3. build passes,
4. a real Modal workspace is created using the default `java21-node22` profile,
5. `java -version` reports Java 21,
6. `node --version` reports Node 22,
7. the workspace is destroyed and its final status is `DESTROYED`.

Do not mark DEV-002 complete until this verification passes.
