# DEV-006 verification – Maven verification

## Implemented

- `MavenVerifier` using the shared `ProjectVerificationResult` model.
- Maven wrapper (`./mvnw`) is preferred when present; permissions are normalized with `chmod +x` before execution.
- Falls back to system `mvn` when no wrapper exists.
- Runs `test`, then `package -DskipTests`.
- Stops immediately on the first failed step.
- Applies the same bounded stdout/stderr and failure excerpt helpers used by npm verification.
- `WorkspaceService.verifyMaven()` validates workspace/project state and resolves the detected Maven project root.
- Modal smoke covers both a passing Maven/JUnit project and an intentionally failing test project.

## Local/provider-neutral verification

The provider-neutral suite includes explicit tests for:

- wrapper preference,
- system Maven fallback,
- PASS step order,
- normalized test failure,
- normalized package failure,
- bounded logs and excerpts.

## Required authenticated verification

On a machine already authenticated with Modal:

```bash
npm install
npm run verify:dev006
```

This runs the full unit/typecheck/build suite and inherited Modal smoke tests, followed by real Maven PASS/FAIL fixtures in Modal.
