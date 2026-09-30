# DEV-015 verification

## Implementerat

- multi-stage Node 22 Dockerfile,
- ingen Docker socket eller lokal build-worker,
- unauthenticated `/health`,
- database-backed `/ready`,
- startup migrations med advisory lock och migration ledger,
- Coolify/environment contract dokumenterat,
- external PostgreSQL,
- deployment healthcheck.

## Verifierat i aktuell miljö

- health-route unit tests,
- TypeScript syntax/transpile för nya deployment-filer,
- Dockerfile statisk kontroll (Node 22 app image; inga Java/Maven/Chromium-paket; ingen docker.sock),
- ZIP-integritet.

## Återstår externt

Miljön här kan inte göra en full `npm install` eller deploy till en riktig Coolify-instans. Kör på vanlig utvecklings-/deploymentmiljö:

```bash
npm install
npm run verify:dev015
```

och därefter ett clean Docker/Coolify deployment med riktig PostgreSQL/OAuth-konfiguration.

DEV-015 får inte markeras fullständigt verifierat förrän containern byggts och `/health`, `/ready`, OAuth/MCP samt provider connectivity har verifierats i deploymentmiljön.
