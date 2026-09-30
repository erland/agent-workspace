# Functional Specification – agent-workspace v1

## 1. Syfte

`agent-workspace` ska ge AI-assistenter en säker, tillfällig remote workspace där kodprojekt kan byggas, testas, köras och visuellt verifieras utan att klienten själv behöver ha Java, Node, Maven, Chromium eller Docker.

## 2. Aktörer

- **Användare** – personen som använder ChatGPT, Claude eller annan kompatibel klient.
- **AI-assistent** – MCP/API-klient som arbetar på användarens uppdrag.
- **Execution provider** – sandbox-tjänst där kod exekveras. V1 stödjer endast Modal.

## 3. Must-scope v1

### FR-001 – Capabilities
Tjänsten ska kunna rapportera vilka runtimes, build systems och browser-funktioner som stöds.

### FR-002 – Användarprofil
En autentiserad klient ska kunna få en begränsad profil som visar vilken användare som är aktiv och om execution account är anslutet. Credentials får aldrig returneras.

### FR-003 – Workspace
En autentiserad användare ska kunna skapa och terminera ett tillfälligt workspace med en låst runtime-profil och begränsad livslängd.

### FR-004 – ZIP upload
En assistent ska kunna ladda upp ett ZIP-arkiv till workspacet. Arkivet ska valideras före extraktion.

### FR-005 – Projektdetektering
Tjänsten ska i v1 detektera:
- Maven-projekt via `pom.xml`,
- npm-projekt via `package.json`.

### FR-006 – Runtime selection
V1 ska stödja:
- Java 17, 21, 25,
- Node 20, 22.

Defaults:
- Java 21,
- Node 22.

Runtime metadata ska kunna detekteras från projekt där den finns. Ett redan skapat workspace ska inte tyst byta runtime efter upload; mismatch ska rapporteras.

### FR-007 – Maven verification
För Maven-projekt ska tjänsten kunna köra test och package. Maven wrapper ska föredras om projektet innehåller den.

### FR-008 – npm verification
För npm-projekt ska tjänsten kunna installera dependencies, köra test när test-script finns och köra build när build-script finns. `npm ci` ska föredras när lämplig lockfile finns.

### FR-009 – Structured verification result
Verifiering ska returnera minst:
- `PASSED` eller `FAILED`,
- projekttyp,
- vald runtime,
- utförda steg,
- exit code,
- duration,
- failure summary och relevant log excerpt vid fel.

### FR-010 – Prototype start
Ett kompatibelt webbprojekt ska kunna startas inne i workspacet och nås av browsern utan krav på publik internet-URL.

### FR-011 – Screenshots
Tjänsten ska kunna köra Chromium via Playwright och returnera PNG-screenshot för minst:
- desktop 1440×900,
- tablet 1024×768,
- mobile 390×844.

### FR-012 – Automatic cleanup
Workspace ska ha TTL och automatiskt termineras även om klienten inte uttryckligen städar upp.

### FR-013 – Per-user execution account
Varje användare ska ha exakt en execution provider/account. V1 stödjer endast `MODAL`. Arkitekturen ska tillåta att andra användare i framtiden kan använda en annan provider utan att MCP-kontraktet ändras.

### FR-014 – Client neutrality
Samma tjänst ska kunna användas från ChatGPT, Claude och andra kompatibla MCP/API-klienter. Användaridentiteten ska tillhöra `agent-workspace`, inte en specifik AI-klient.

## 4. MCP tools v1

- `get_capabilities`
- `get_profile`
- `workspace_create`
- `workspace_upload_zip`
- `project_verify`
- `prototype_start`
- `prototype_screenshot`
- `workspace_destroy`

Generell publik `shell_exec` ingår inte i v1.

## 5. Icke-funktionella krav

### NFR-001 – Säker exekvering
Okänt innehåll i uppladdade ZIP-filer ska betraktas som potentiellt fientligt. Exekvering ska ske hos sandbox provider, inte på `agent-workspace`-servern.

### NFR-002 – Credentials
Execution-provider credentials och andra server-secrets får aldrig exponeras inne i användarens sandbox.

### NFR-003 – Reproducerbar runtime
Workspace ska lagra vald runtime-profil under hela sin livslängd.

### NFR-004 – Begränsningar
V1 ska ha konfigurerbara gränser för ZIP-storlek, extraherad storlek, antal filer, workspace TTL, CPU, minne och command timeout.

Initiala ZIP-gränser:
- max ZIP: 100 MB,
- max extraherat: 500 MB,
- max filer: 20 000.

### NFR-005 – Provider isolation
Domänlogik och MCP-lager ska inte bero direkt på Modal SDK. Execution ska gå via ett provider-interface.

### NFR-006 – Deployment
`agent-workspace` ska kunna deployas som containeriserad tjänst, med Coolify som målprofil. Java/Maven/Node/Chromium ska inte krävas på applikationsservern.

## 6. Acceptance criteria v1

V1 är funktionellt accepterad när en autentiserad testanvändare med anslutet Modal-konto kan:

1. ladda upp ett npm-projekt och få korrekt PASS/FAIL,
2. ladda upp ett Maven-projekt och få korrekt PASS/FAIL,
3. välja/autoidentifiera stödd Java/Node-runtime,
4. starta en Vite/React-liknande prototyp,
5. få tillbaka desktop-, tablet- och mobile-screenshots,
6. få workspacet automatiskt eller explicit terminerat,
7. göra detta genom MCP-kontraktet utan provider-specifika parametrar.

## 7. Out of scope v1

- fler execution providers än Modal,
- en användare med flera samtidiga providers,
- Gradle,
- pnpm/yarn,
- Python build workflows,
- Git repository integration,
- CI/CD-plattform,
- permanent project hosting,
- team sharing,
- publik generell shell-tjänst,
- egen build farm eller Docker socket på appservern.
