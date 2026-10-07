# Development Plan – agent-workspace v1

## Goal and delivery scope

Leverera en säker multi-user MCP-tjänst där AI-assistenter kan verifiera och bygga npm/Maven-projekt via användarens Modal execution account och publicera tillfälliga build-artifacts. Preview-hosting och screenshots ägs av separata tjänster.

## Planning assumptions

- V1 execution provider är endast Modal.
- Provider-interface ska vara generiskt nog för framtida providers men inga andra providers implementeras i v1.
- Default runtime är Java 21 + Node 22.
- Modal-PoC verifierade ursprungligen npm, Maven, Vite, Chromium och Playwright. Browser/prototype-delarna är historisk evidens och ingår inte längre i Agent Workspace målarkitektur.
- Per-user Modal account linking behöver en separat feasibility-verifiering innan produktionsauth färdigställs.

## Step overview

| ID | Titel | Primärt utfall |
|---|---|---|
| DEV-001 | Projektgrund och Modal execution spike | TS-projekt + provider-interface + riktig sandbox `node --version` |
| DEV-002 | Workspace-livscykel och default runtime | create/destroy + TTL + Java21/Node22 |
| DEV-003 | ZIP upload och säker validering | archive in → validerad project tree |
| DEV-004 | Projekt- och runtime-detektering | Maven/npm + Java/Node metadata |
| DEV-005 | npm verification | strukturerat PASS/FAIL för npm |
| DEV-006 | Maven verification | strukturerat PASS/FAIL för Maven |
| DEV-007 | Övriga runtime-profiler | Java17/25 och Node20 |
| DEV-008 | Prototype start (historisk) | tidigare verifierad capability, senare retirerad |
| DEV-009 | Playwright screenshots (historisk) | tidigare verifierad capability, senare flyttad till Browser Screenshot |
| DEV-010 | MCP-kontrakt | nuvarande build/artifact-orienterade MCP-yta |
| DEV-011 | Auth/account-linking feasibility spike | verifierat produktionsbart user→Modal flow |
| DEV-012 | Multi-user identity och persistence | User/ExecutionAccount/Workspace i PostgreSQL |
| DEV-013 | OAuth-skyddat remote MCP | ChatGPT/andra klienter autentiserar mot tjänsten |
| DEV-014 | Security hardening | limits, cleanup, secrets, network policy review |
| DEV-015 | Coolify deployment | containeriserad tjänst + DB |
| DEV-016 | End-to-end acceptance | npm + Maven + build/artifact via riktig MCP-klient |
| DEV-017 | Release readiness | docs, operations, packaging, release candidate |

## Development steps

## DEV-001 – Projektgrund och Modal execution spike

### Mål

Etablera en minimal Node 22/TypeScript-kodbas med `SandboxProvider` och `ModalSandboxProvider`, och bevisa från den nya arkitekturen att en riktig Modal sandbox kan skapas, köra `node --version` och termineras.

### Scope

**Ingår**
- package/tooling för TypeScript Node 22,
- minimal config validation för dev Modal credentials,
- provider-neutrala core typer,
- `SandboxProvider` interface,
- `ModalSandboxProvider`,
- ett körbart smoke command/script,
- unit tests för provider-oberoende mapping där meningsfullt.

**Ingår inte**
- ZIP upload,
- npm/Maven verification,
- MCP server,
- OAuth,
- PostgreSQL,
- runtime matrix utöver den image som behövs för smoke test.

### Förutsättningar

- Modal dev credentials finns lokalt vid manuell integrationstest.

### Verifiering

- `npm test` / motsvarande testkommando,
- typecheck,
- smoke integration mot Modal: create → `node --version` → terminate.

### Klart-kriterier

- [ ] TypeScript-projekt bygger/typecheckar.
- [ ] Core-lager importerar inte Modal SDK.
- [ ] `ModalSandboxProvider` implementerar provider-kontraktet för create/exec/terminate.
- [ ] Riktig Modal sandbox kör `node --version` framgångsrikt.
- [ ] Sandbox termineras även vid fel.

### Beroenden

- planning handoff complete.

## DEV-002 – Workspace-livscykel och default runtime

### Mål

Införa provider-neutral workspace-livscykel med runtime `java21-node22`, status och TTL.

### Scope

- `WorkspaceService`,
- create/destroy,
- workspace id/handle mapping,
- expiry metadata och cleanup fallback,
- default runtime profile.

### Verifiering

- unit tests för lifecycle/state,
- Modal integration create/destroy,
- expiry behavior verifierat.

### Klart-kriterier

- [ ] Workspace kan skapas och förstöras.
- [ ] Runtime låses vid creation.
- [ ] TTL registreras och cleanup kan köras idempotent.

### Beroenden

- DEV-001.

## DEV-003 – ZIP upload och säker validering

### Mål

Ta emot ZIP, validera den och föra över säkert innehåll till workspacet.

### Scope

- max compressed/uncompressed size,
- max file count/path length,
- Zip Slip/path traversal-skydd,
- malformed archive handling,
- upload till provider filesystem.

### Verifiering

- unit/integration tests för giltig ZIP, traversal, zip bomb-liknande limit och malformed archive.

### Klart-kriterier

- [ ] Giltig ZIP når workspacet (implementation klar; live Modal-verifiering återstår).
- [x] Olagliga paths blockeras i provider-neutrala tester.
- [x] Limits ger strukturerade fel i provider-neutrala tester.

### Beroenden

- DEV-002.

## DEV-004 – Projekt- och runtime-detektering

### Mål

Detektera npm/Maven och projektets efterfrågade Java/Node-version.

### Scope

- `pom.xml`,
- `package.json`,
- `.nvmrc`, `.node-version`, Volta,
- mismatch warning mot låst workspace runtime.

### Verifiering

- fixture-baserade tests för Java 17/21/25 och Node 20/22 samt ambiguous/unsupported cases.

### Klart-kriterier

- [x] Maven/npm identifieras korrekt i fixture-baserade tester.
- [x] Stödda runtimes identifieras där metadata finns.
- [x] Default/mismatch är deterministiskt och dokumenterat.

### Beroenden

- DEV-003 (implementation klar; live Modal-verifiering återstår).

## DEV-005 – npm verification

### Mål

Verifiera npm-projekt och returnera normaliserat PASS/FAIL.

### Scope

- install strategy,
- optional test/build scripts,
- command timeout,
- bounded stdout/stderr,
- failure summary/log excerpt.

### Verifiering

- passing och failing npm fixtures i riktig Modal sandbox.

### Klart-kriterier

- [x] PASS-projekt returnerar korrekt steps/duration i provider-neutrala tester.
- [x] FAIL-projekt returnerar failed step/exit code/log excerpt i provider-neutrala tester.
- [ ] Passing och failing npm fixtures verifierade i riktig Modal sandbox.

### Beroenden

- DEV-004.

## DEV-006 – Maven verification

### Mål

Verifiera Maven-projekt och returnera samma normaliserade resultatmodell.

### Scope

- `./mvnw` före `mvn`,
- `test`,
- `package -DskipTests`,
- bounded logs/timeouts.

### Verifiering

- passing och failing Maven fixtures i riktig Modal sandbox.

### Klart-kriterier

- [x] Maven wrapper prioriteras när den finns i provider-neutrala tester.
- [x] PASS/FAIL följer gemensam result model i provider-neutrala tester.
- [ ] Passing och failing Maven fixtures verifierade i riktig Modal sandbox.

### Beroenden

- DEV-004.

## DEV-007 – Övriga runtime-profiler

### Mål

Utöka från default Java21/Node22 till hela v1-matrisen.

### Scope

- Java 17 och 25,
- Node 20,
- sex provider-neutrala runtime profiler,
- capability reporting.

### Verifiering

- varje runtime kan startas och rapporterar förväntad Java/Node-version.

### Klart-kriterier

- [ ] Java 17/21/25 fungerar.
- [ ] Node 20/22 fungerar.
- [ ] Java21/Node22 är default.

### Beroenden

- DEV-002, DEV-004.

## DEV-008 – Prototype start

> Historiskt steg. Capabilityn implementerades och verifierades, men har senare retirerats från Agent Workspace när preview-ansvaret flyttades till PWA Preview.


### Mål

Starta kompatibel npm-webbprototyp och verifiera readiness inne i sandboxen.

### Scope

- install dependencies,
- deterministic start strategy,
- local port/readiness,
- process cleanup.

### Verifiering

- Vite/React fixture startar och svarar på localhost.

### Klart-kriterier

- [x] Prototype returnerar RUNNING först efter readiness.
- [x] Failure returnerar strukturerat startfel.

### Beroenden

- DEV-005.

## DEV-009 – Playwright screenshots

> Historiskt steg. Capabilityn implementerades och verifierades, men har senare retirerats från Agent Workspace när browser/screenshot-ansvaret flyttades till Browser Screenshot.


### Mål

Returnera PNG-bilder från Chromium för definierade viewports.

### Scope

- Playwright + Chromium,
- desktop/tablet/mobile presets,
- optional explicit width/height,
- image bytes + metadata.

### Verifiering

- tre screenshots genereras mot fixture och kan öppnas som PNG.

### Klart-kriterier

- [ ] Desktop/tablet/mobile fungerar.
- [ ] Browser stängs vid success/failure.

### Beroenden

- DEV-008.

## DEV-010 – MCP-kontrakt

### Mål

Exponera ett provider-neutralt MCP-kontrakt för workspace, verification, build och artifacts.

### Scope

Current retained surface:
- `get_capabilities`,
- `get_profile`,
- `workspace_create`,
- `workspace_upload_zip`,
- `workspace_upload_zip_from_url`,
- `project_verify`,
- `project_build`,
- `artifact_get`,
- `artifact_download_link`,
- `workspace_destroy`,
- Zod schemas,
- standardiserad felmodell.

Prototype/screenshot tools that existed in the original DEV-010 milestone are historical and have been retired.

### Verifiering

- MCP contract tests,
- lokal end-to-end genom MCP-klient mot dev execution account.

### Klart-kriterier

- [ ] Alla retained tools har stabil input/output-schema.
- [ ] Modal-specifika parametrar exponeras inte.
- [ ] Build artifacts kan hämtas som MCP resource eller signerad HTTPS-länk.

### Beroenden

- DEV-005, DEV-006, DEV-009.

## DEV-011 – Auth/account-linking feasibility spike

### Mål

Verifiera exakt produktionsbart flöde för en Agent Workspace-användare att koppla sitt eget Modal account.

### Scope

- verifiera Modal third-party auth/account-linking mekanism,
- credential lifecycle,
- refresh/revoke,
- server-side client construction,
- dokumentera accepterat flöde.

### Verifiering

- två separata testidentiteter kan exekvera sandboxes på respektive account utan credential leakage.

### Klart-kriterier

- [ ] Flödet är verifierat mot Modal, inte bara antaget.
- [ ] Secrets storage/revocation definierad.
- [ ] Arkitekturen uppdateras endast om verifierad evidens kräver det.

### Beroenden

- DEV-010.

## DEV-012 – Multi-user identity och persistence

### Mål

Införa PostgreSQL-baserad User, ExecutionAccount och Workspace metadata.

### Scope

- migrations,
- provider credential references only in PostgreSQL; secret material remains in the encrypted/managed credential store,
- workspace reconciliation,
- en provider per user.

### Verifiering

- persistence/integration tests,
- restart/reconciliation scenario.

### Klart-kriterier

- [x] Användares execution accounts är isolerade i provider-neutrala/repository-tester.
- [x] Workspace metadata kan rehydreras efter restart i provider-neutrala tester.
- [ ] PostgreSQL migration/repositories verifierade mot riktig PostgreSQL-instans.

### Beroenden

- DEV-011.

## DEV-013 – OAuth-skyddat remote MCP

### Mål

Göra MCP-servern säkert användbar från externa klienter.

### Scope

- standards-baserad OAuth för `agent-workspace`,
- authorization checks per tool,
- profile identity,
- ChatGPT-kompatibel remote MCP discovery/auth.

### Verifiering

- autentiserad extern MCP-klient kan ansluta,
- unauthenticated/other-user access nekas.

### Klart-kriterier

- [ ] Remote MCP kräver giltig användaridentitet.
- [ ] `get_profile` visar rätt account utan secrets.

### Beroenden

- DEV-012.

## DEV-014 – Security hardening

### Mål

Slutföra v1:s säkerhetsbaseline för publik/multi-user drift.

### Scope

- rate/resource limits,
- TTL cleanup jobs,
- ZIP limits,
- bounded logs,
- credential redaction,
- provider network-policy review,
- audit-relevanta events.

### Verifiering

- abuse/error-path tests och security checklist.

### Klart-kriterier

- [ ] Inga provider/server-secrets når sandbox eller log excerpts.
- [ ] Resource/TTL limits enforced.
- [ ] Cleanup fungerar efter avbrutna jobs.

### Beroenden

- DEV-013.

## DEV-015 – Coolify deployment

### Mål

Deploya tjänsten reproducerbart i Coolify utan lokal build-worker.

### Scope

- Dockerfile,
- health endpoint,
- config/env contract,
- external PostgreSQL,
- deployment docs.

### Verifiering

- clean deployment till Coolify-lik container environment,
- health/auth/provider connectivity checks.

### Klart-kriterier

- [ ] Ingen Docker socket krävs.
- [ ] Java/Maven/Chromium krävs inte på apphost.

### Beroenden

- DEV-014.

## DEV-016 – End-to-end acceptance

### Mål

Verifiera fulla v1-flöden via riktig MCP-klient.

### Scope

- npm PASS/FAIL,
- Maven PASS/FAIL,
- Java/Node runtime selection,
- build/artifact publication,
- signed artifact handoff,
- cleanup.

### Verifiering

- local pre-deployment acceptance via real stdio MCP client + real Modal,
- final remote acceptance against deployed service after DEV-015 deployment verification,
- acceptance criteria in functional specification.

### Klart-kriterier

- [ ] npm PASS/FAIL passes through MCP.
- [ ] Maven PASS/FAIL passes through MCP.
- [ ] Runtime selection passes through MCP.
- [ ] Build/artifact publication and handoff pass through MCP.
- [ ] Cleanup passes for every acceptance case.
- [ ] Final remote/deployed path is verified before DEV-016 is marked complete.

### Beroenden

- Implementation of the local acceptance harness does not require deployment.
- Completion of DEV-016 still depends on DEV-015 deployment verification.

## DEV-017 – Release readiness

### Mål

Göra v1 releasebar.

### Scope

- final docs reconciliation,
- operations/install docs,
- release packaging,
- known limitations,
- release candidate verification.

### Verifiering

- full regression + documentation/release checklist.

### Klart-kriterier

- [ ] Ingen required verification är failed/blocked.
- [ ] Canonical docs och source överensstämmer.
- [ ] Installation/operations är reproducerbara.

### Beroenden

- DEV-016.

## Cross-cutting verification

Varje steg ska minst köra relevant subset av:
- format/lint,
- typecheck,
- unit tests,
- integration tests,
- provider smoke tests,
- MCP contract tests,
- container build,
- security/repository hygiene review.

## Plan-change rules

- Ett steg får delas om ny evidens visar att scope är för stort.
- Blockerande feasibility-risk går före numerisk planordning.
- Failed required verification repareras innan nästa steg.
- Funktionell specification/architecture ändras endast vid explicit accepterat intent/architecture-beslut, inte för att matcha oavsiktlig implementation drift.

### DEV-015 implementation note

Implementation now includes the production Dockerfile, `/health` and `/ready`, PostgreSQL startup migrations and Coolify configuration documentation. Clean container/Coolify deployment remains external verification before DEV-015 can be marked fully complete.


## DEV-018 – Personal Modal credentials and settings

Goal: allow an allowlisted authenticated user to configure and use their own Modal API credentials without third-party Modal OAuth.

Implementation:
- Agent Workspace OAuth authorization server shared by `/mcp` and `/settings`.
- Google OAuth/OIDC as the upstream human identity provider.
- RFC 9728/RFC 8414 discovery, Authorization Code + mandatory PKCE S256, local JWKS and resource-bound Ed25519 JWT access tokens.
- persistent Dynamic Client Registration plus opt-in trusted-origin Client ID Metadata Documents.
- one-time hashed authorization codes and rotating hashed refresh tokens.
- signed HttpOnly/Secure application session and CSRF-protected settings forms.
- AES-256-GCM encrypted PostgreSQL Modal credential store behind `ExecutionAccountCredentialStore`.
- per-user `ExecutionAccount.credentialRef`.
- save-and-test, connection test and disconnect actions.
- explicit renewal state when Modal reports authentication failure; settings shows "Modal-token behöver förnyas" and successful replacement restores CONNECTED.
- legacy `env:` Modal credentials and external OAuth verifier remain available for backward compatibility.

Required verification:
- [x] automated encryption/decryption, tamper and wrong-key tests are implemented.
- [x] automated save/invalid/disconnect/user-isolation tests are implemented.
- [x] full CI passes on the shared-auth DEV-018 branch (GitHub Actions run 36762061458).
- [ ] deployed Google login to `/settings` is verified.
- [ ] deployed MCP OAuth discovery + Authorization Code/PKCE + refresh flow is verified with the actual MCP client.
- [ ] an allowlisted user saves a real personal Modal token and connection verification passes.
- [ ] a second user is verified to execute through a distinct Modal account.
- [ ] disconnect is verified in the deployed environment.
