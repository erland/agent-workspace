> Historical verification record. The prototype/screenshot capability described here has been retired from the current Agent Workspace surface. Current preview/browser responsibilities are owned by PWA Preview and Browser Screenshot; see `docs/service-boundaries.md`.

# DEV-009 verification

## Scope

- Playwright + Chromium screenshot capture for a running prototype.
- Presets: desktop 1440×900, tablet 1024×768, mobile 390×844.
- Optional explicit viewport dimensions, bounded to 1–4096 px.
- PNG bytes + metadata returned from the provider-neutral service.
- Browser lifecycle uses `try/finally` so Chromium is closed on success and failure.

## Local/provider-neutral verification

`test/screenshot-service.test.ts` covers preset and explicit viewports, PNG validation, structured browser failure, artifact reads, and command construction. Capability reporting is updated to advertise Chromium/screenshots.

## Required authenticated verification

Run:

```bash
npm install
npm run verify:dev009
```

The smoke must start a Vite fixture in Modal, capture desktop/tablet/mobile screenshots, write all three PNG files under `output-dev009/`, and destroy the workspace.

DEV-009 remains verification-pending until that authenticated Modal smoke passes.
