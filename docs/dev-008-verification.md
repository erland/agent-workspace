# DEV-008 verification

## Scope

DEV-008 adds npm prototype startup inside an existing workspace. It installs dependencies, deterministically selects `dev`, then `start`, then `preview`, launches the process in the sandbox, and returns `RUNNING` only after an HTTP readiness probe succeeds.

Vite scripts are bound explicitly to `127.0.0.1:4173`. Other start scripts receive `HOST=127.0.0.1` and `PORT=4173`. If `preview` is selected and a build script exists, the project is built before preview starts.

Failed startup/readiness returns a structured failure and the background process is cleaned up. Normal workspace destruction also terminates the entire sandbox and therefore the prototype process.

## Local/provider-neutral evidence

Run:

```bash
npm test
npm run typecheck
npm run build
```

## Authenticated Modal verification

Run on the authenticated development Mac:

```bash
npm run verify:dev008
```

Expected live evidence:

- Java 21 / Node 22 workspace is created,
- Vite is downloaded with npm,
- the Vite process starts in the sandbox,
- readiness against `http://127.0.0.1:4173` passes,
- result status is `RUNNING`,
- workspace is destroyed afterwards.

Playwright/Chromium/screenshots are explicitly DEV-009 and are not part of this step.
