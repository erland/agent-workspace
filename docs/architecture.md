# Architecture – agent-workspace v1

## 1. Arkitekturstil

Modulär monolit i TypeScript/Node 22 med ett provider-neutralt execution-interface.

```text
ChatGPT / Claude / MCP client
            |
         MCP + OAuth
            v
+-----------------------------+
| agent-workspace             |
|                             |
| MCP/API layer               |
| Auth / identity             |
| WorkspaceService            |
| RuntimeResolver             |
| VerificationService         |
| ArtifactService             |
| SandboxProvider             |
+-------------+---------------+
              |
              v
     ModalSandboxProvider
              |
              v
       User's Modal account
              |
              v
        Modal Sandbox
```

## 2. Teknikstack

- Node 22
- TypeScript
- official MCP SDK
- Fastify eller motsvarande tunt HTTP-lager där HTTP endpoints behövs
- Zod för externa kontrakt/config validation
- Modal JavaScript/TypeScript SDK
- PostgreSQL när multi-user persistence introduceras
- container deployment med Coolify som målprofil

## 3. Provider-abstraktion

Domän- och MCP-lager ska bero på ett interface, inte Modal SDK.

Konceptuellt kontrakt:

```ts
interface SandboxProvider {
  createWorkspace(options: CreateWorkspaceOptions): Promise<WorkspaceHandle>;
  uploadArchive(handle: WorkspaceHandle, archive: Uint8Array): Promise<void>;
  exec(handle: WorkspaceHandle, command: Command): Promise<ExecutionResult>;
  readFile(handle: WorkspaceHandle, path: string): Promise<Uint8Array>;
  writeFile(handle: WorkspaceHandle, path: string, content: Uint8Array): Promise<void>;
  terminate(handle: WorkspaceHandle): Promise<void>;
}
```

V1 implementation:

```text
ModalSandboxProvider
```

Framtida providers får implementera samma core capabilities. Provider-specifika features får inte läcka in i v1 MCP-kontraktet.

## 4. Execution account

Varje användare har exakt en execution provider/account.

```text
User
└── ExecutionAccount
    ├── provider = MODAL (v1)
    ├── providerAccountId
    ├── credentialRef
    └── status

credentialRef → server-side encrypted secret/secret-manager entry
              → Modal OAuth refresh token
```

V1 stödjer bara Modal. Datamodellen ska inte kräva att en användare har flera providers samtidigt.

## 5. Runtime-profiler

Runtime toolchains are prebuilt outside Modal job execution and published as public GHCR images. Agent Workspace does not run apt/npm/Playwright installation during normal workspace creation.

```text
GitHub Actions
   |
   +--> ghcr.io/erland/agent-workspace-runtime:java21-node22-v1
                                                    |
                                                    v
                                      Modal images.fromRegistry()
                                                    |
                                      per-account Modal image cache
                                                    |
                                                    v
                                                Sandbox
```

No Modal credential is stored in GitHub. Runtime publication uses GitHub's repository-scoped `GITHUB_TOKEN`. Because pilot users execute in separate Modal accounts, the GHCR runtime package must allow anonymous pulls.

Extern modell:

```text
java17-node20
java17-node22
java21-node20
java21-node22  <- default
java25-node20
java25-node22
```

Runtime selection priority:

```text
explicit request
→ project metadata
→ default
```

Java metadata kan inkludera relevanta `pom.xml` properties. Node metadata kan inkludera `package.json engines.node`, `.nvmrc`, `.node-version` och Volta-konfiguration.

Ett workspace får en låst runtime-profil vid creation. Upload kan rapportera mismatch men får inte tyst byta profil.

Each profile resolves to a versioned registry tag such as `ghcr.io/erland/agent-workspace-runtime:java21-node22-v1`. The runtime image contains the build toolchain required by the supported runtime profile. Browser tooling is not part of the Agent Workspace target architecture. `bootstrapCommands` is intentionally empty in production runtime profiles.

## 6. Workspace state

Pre-persistence development state kan hållas processlokalt under tidiga steg. När multi-user/auth introduceras persisteras minst:

```text
Workspace
├── id
├── userId
├── runtimeProfile
├── status
├── createdAt
└── expiresAt
```

Projektfiler lagras i sandboxen, inte i PostgreSQL.

## 7. Verification strategies

### npm

- `npm ci` när kompatibel lockfile finns, annars `npm install`.
- `npm test` om script finns.
- `npm run build` om script finns.

### Maven

- använd `./mvnw` om wrapper finns,
- annars systemets Maven i runtime-imagen,
- kör `test`,
- kör `package -DskipTests`.

Alla resultat normaliseras till provider-neutrala `ExecutionResult`/`VerificationResult`.

## 8. Artifact handoff

Build outputs are published as temporary artifacts. Static web outputs can be handed to PWA Preview through a short-lived signed URL from `artifact_download_link`. Browser rendering and screenshots belong to Browser Screenshot.

## 9. Säkerhetsgränser

- ingen Docker socket på appservern,
- ingen användarkod exekveras på appservern,
- provider credentials stannar i backend/provider-klient,
- inga backend secrets förs in i sandboxen,
- ZIP valideras före extraktion,
- TTL, CPU, memory och timeout begränsas,
- sandbox cleanup sker explicit och genom TTL fallback.

## 10. Deployment

Coolify host:

```text
agent-workspace container
PostgreSQL (när persistence krävs)
```

Modal hostar all build-exekvering. Coolify-servern behöver därför inte Java, Maven eller Node build tooling för användarprojekten.

## 11. Multi-user persistence (DEV-012)

PostgreSQL becomes the system of record for identity and workspace metadata:

```text
app_user
  ├── external_identity (issuer + subject)
  ├── execution_account (exactly one per user in v1)
  └── workspace
```

`execution_account` stores `credentialRef`, never Modal refresh tokens, token secrets or OAuth client secrets. Credential material remains behind the server-side `ExecutionAccountCredentialStore` boundary from DEV-011.

Workspace rows are ownership-scoped by `user_id` and persist logical workspace metadata only: runtime, status, expiry and optional project metadata. Execution provider handles are deliberately not persisted because verify/build sandboxes are short-lived and terminated in the operation `finally` path. Project source files remain in temporary object storage and are copied into execution sandboxes as needed.

`WorkspaceService` accepts an optional `WorkspaceRepository`. With persistence enabled it writes state transitions, can rehydrate a workspace after process restart and can reconcile persisted expired READY workspaces through `cleanupExpired()`.

## Deployment boundary (DEV-015)

Production `agent-workspace` is a single Node 22 application container plus external PostgreSQL. The application container contains only the control plane. It never mounts Docker socket and does not contain Java, Maven, Chromium or user-project build tooling. User code execution remains behind `SandboxProvider` (Modal in v1).

`/health` is an unauthenticated liveness endpoint. `/ready` verifies PostgreSQL connectivity. The MCP endpoint remains OAuth protected at `/mcp`.


## 12. Personal Modal credential settings

Pilot users may connect their own Modal account without Modal third-party OAuth by entering a normal Modal API Token ID + Token Secret in the authenticated `/settings` page.

Agent Workspace is the OAuth authorization server for both MCP and settings. Google is an upstream OpenID Connect identity provider used only to authenticate the human. After Google login, Agent Workspace issues its own access/refresh tokens for the MCP resource and uses the same upstream identity in the settings session.

MCP authorization uses RFC 9728 protected-resource metadata plus RFC 8414 authorization-server metadata. Authorization Code + PKCE S256 is mandatory. Access tokens are short-lived Ed25519-signed JWTs with audience bound to the exact MCP resource. Authorization codes and refresh tokens are opaque, stored only as SHA-256 hashes, and consumed once; refresh is rotation-based.

Public MCP clients can use Dynamic Client Registration. Client ID Metadata Documents are accepted only from explicitly configured trusted origins, avoiding arbitrary server-side metadata fetching.

Credential storage:

```text
app_user
  └── execution_account
       └── credential_ref = secret:modal:<user-id>
                |
                v
        execution_credential
        AES-256-GCM ciphertext
                |
                v
        ModalSandboxProvider
```

The encryption master key is supplied only through `AGENT_WORKSPACE_CREDENTIAL_ENCRYPTION_KEY`. The encrypted store remains behind `ExecutionAccountCredentialStore`, allowing later replacement with an external secret manager without changing domain or MCP layers.

Legacy `env:` credential references remain readable for development/backward compatibility. New user-managed credentials are persistent encrypted records.


## 13. Authentication topology

```text
MCP client                         Browser
    |                                 |
    | RFC 9728 / RFC 8414             | /settings/login
    v                                 v
Agent Workspace OAuth Authorization Server
    |
    | Google OAuth/OIDC
    v
Google account
    |
    v
Agent Workspace identity (Google issuer + subject)
    |
    +--> local JWT access token --> /mcp
    |
    +--> signed web session ------> /settings
```

Google credentials are never accepted directly by `/mcp`. This keeps resource/audience/scope enforcement under Agent Workspace control while retaining Google as the single human identity source.

## LANG-001: Gemensamt verifieringsgränssnitt

`src/verification/verifier-registry.ts` innehåller `ProjectVerifier` med metoden `verify(handle)`, ett typat `VerifierContext` samt en serverstyrd registrering av verifieringsmotorer. Existerande Maven-, npm- och Python-verifierare implementerar gränssnittet och registreras genom fabriksfunktioner. `WorkspaceService.verifyProject` väljer motor via registret, inte genom språkberoende villkor.

- **Projektidentifiering** fortsätter i `project-detector.ts` och den befintliga logiken för val av projektrot och samordnad verifiering av blandprojekt kvarstår.
- **Sandboxlivscykel, loggar och artefakter** ägs fortsatt av `WorkspaceService`. En verifierare får bara sandboxprovidern, en säker projektrot och stödjande körmiljöinformation.
- **Säkerhet**: registreringar definieras av serverkoden. ZIP-projekt får aldrig registrera godtyckliga exekveringsmotorer.
- **Utökning**: en ny motor implementerar `ProjectVerifier`, registreras med manifest och fabrik, och kompletteras separat med identifiering, runtimebild, byggartefakter och tester. Registret innebär inte automatiskt att projektidentifiering eller `project_build` kan hantera en ny typ.

LANG-001 ändrar inte det publika MCP-kontraktet eller den befintliga logiken för Maven, npm och Python. Gradle följer i ett separat steg.


## LANG-003A: Separat Rust-runtime som framtida Tauri-bas

Agent Workspace har en ny frivillig runtimeprofil `rust`, vald genom `workspace_create({rust:true})`. Den återanvänder `RuntimeProfile`, sandboxisolering och profilbaserad `imageRef` från Playwright utan att ha Java eller Node installerat. `rust:true` går inte att kombinera med Java-/Node-versioner eller Playwright. Standardprofilen `java21-node22` ändras inte.

Den publicerade containern är `ghcr.io/erland/agent-workspace-runtime:rust-v1`. Versionen kommer från `rust-runtime/version.txt` och är **oberoende** av Java/Node-bildernas `runtime-images/version.txt` (i nuläget v9). Byggning, Cargo-smoketester som icke-root och Trivy-skanning görs i det egna arbetsflödet `.github/workflows/rust-runtime.yml`. På main publiceras imagen efter validering, och befintliga taggar får inte skrivas över. Ändra Rust-version och öka Rust-imageversion vid nästa uppdatering.

Bas: `ubuntu:24.04` med Rust 1.99.1 installerat via Rustup som icke-root under imagebygget, inklusive, Cargo, Clippy, rustfmt, GCC, OpenSSL-utvecklingsbibliotek, Python, git och vanliga verktyg. `/workspace` ägs av den obehöriga användaren `agent-workspace`. Rustup/Cargo-hemkatalogerna kan användas i sandboxen, men projektbaserat verktygskedjeval får separat policystyrning i LANG-003B.

**Gränser:** Denna PR levererar endast runtimefamiljen, explicit val och build/publish-pipeline för imagen. Den deklarerar INTE Rust i `buildSystems` eller `projectDetection` förrän Cargo-verifiering och projektidentifiering genomförs i LANG-003B. På samma sätt finns inget stöd för Tauri eller Windows/macOS-artifakter än. En workspace som skapas med `rust:true` och sedan får ett befintligt npm/Maven-projekt ska inte användas för att verifiera det projektet; exekveringsmotorn förväntar sig rätt verktyg i vald image. Nästa steg kommer att ha explicit matchning mellan Cargo-projekt och runtime.

För LANG-003C ska en separat Tauri-image byggas från samma versionspinnade Rust-grund och lägga till Node.js och WebKitGTK, utan att skapa kombinationer med Java-versioner.

### Säkerhetsgranskning av Rust-basimagen (2026-11-08)

Rust-imagen byggs på Ubuntu 24.04 och uppdaterar installerade paket före distribution. Vid första skanningen identifierade Trivy 385 HIGH/CRITICAL-fynd, **alla tilldelade paketet `linux-libc-dev`**. Det paketet innehåller Linux-kärnans utvecklingsheaders, inte den körande kärnan i Modal-sandboxen. Trivy tilldelar sårbarheter från Linux-källpaketet även till headers som inte nödvändigtvis är exponerade av den specifika CVE:n. Detta är en riskbedömning, inte ett påstående att varje fynd är felaktigt.

Det separata Rust-workflowet gör därför två skanningar: (1) sparar ett **ofiltrerat** JSON-resultat i GitHub Actions-artefakten `rust-trivy-unfiltered-report`; (2) använder `rust-runtime/trivy-kernel-headers.rego` för att enbart undanta sårbarhetsfynd mot `linux-libc-dev` från den blockerande skanningen. Andra OS-/biblioteksfynd och hemlighetsfynd fortsätter att stoppa publicering. Undantaget **upphör 2026-12-08**, då workflowet automatiskt blockerar publicering tills det har omprövats eller tagits bort. Se även Trivys diskussion om kernel headers (aquasecurity/trivy#6562).

Vid en framtida Rust-/Tauri-imageuppdatering ska en ny granskning av både CVE-rapport och headerbehov göras. Policyn ska inte återanvändas okritiskt i andra images.

## LANG-003B: Cargo verifiering och byggning

`Cargo.toml` identifierar Rust/Cargo-projekt. Cargo-workspaces identifieras med manifest för roten och medlemmar; verifiering av en överordnad workspace kör `--workspace`, så samma medlemmar inte verifieras separat en gång till. Det finns ingen Java-/Node-koppling till Cargo och runtimeprofilen `rust` måste väljas uttryckligen i `workspace_create({rust:true})`.

`project_verify` kör `cargo fmt --all -- --check`, `cargo check --workspace --all-targets`, `cargo clippy --workspace --all-targets -- -D warnings` och `cargo test --workspace --all-targets`. Testkommandot måste faktiskt rapportera minst ett exekverat test för PASS. Fel på något steg blir FAILED; inga testfall blir BLOCKED. Rust-kompilatorn är versionslåst i runtime-imagen och projektets `rust-toolchain`/`rust-toolchain.toml` blockeras i detta steg för att undvika okontrollerade automatiska nedladdningar. Policy för projektstyrd Rust-version tas separat när behöriga toolchains definierats.

`project_build` rensar tidigare releaseutdata med `cargo clean --release`, kör `cargo build --release --workspace`, och använder `cargo metadata --no-deps --format-version 1` för att samla verkliga `bin`-targets från workspace-medlemmar. Utdata `target/release/<binary>` publiceras som `linux-binary` med befintliga artefaktgränser och signerade nedladdningslänkar. Projekt som enbart bygger bibliotek behöver ange explicita utdata; inga fiktiva binärer publiceras.

Ett logiskt workspace kan för närvarande enbart ha **en** runtimeimage. Blandprojekt med Cargo och Maven/npm/Python/Gradle avvisas därför vid samordnad verifiering med ett tydligt fel, och användaren väljer separata projektrotsval och workspaces. Detta undviker ett falskt PASS och kommer att ersättas av samordning av flera sandboxar i ett senare steg. Kompletta Tauri-projekt kräver en separat Tauri-runtime (LANG-003C).

## LANG-003C: Separat Linux-runtime för Tauri v2

Tauri har en separat runtimeprofil `tauri-linux` (MCP: `workspace_create({tauri:true})`) med Rust 1.99.1, Node 22.21.1/npm, `libwebkit2gtk-4.1-dev`, Ayatana AppIndicator, `librsvg2-dev`, `libxdo-dev` och nödvändiga Linux-byggbibliotek. **Ingen Java-installation** behövs. Profilen använder `debian:trixie-slim` som Linux-bas och **kopierar endast den versionslåsta Rust-verktygskedjan** från `ghcr.io/erland/agent-workspace-runtime:rust-v1`, utan att kopiera Ubuntu-systembibliotek. Den kompletteras med Node från en fast version av officiell Node-image; CLI- och Tauri-versioner följer projektets beroenden/låsfiler och är inte globalt installerade.

Tauri-bilden har **egen** version i `tauri-runtime/version.txt`; initial publicerad tagg är `ghcr.io/erland/agent-workspace-runtime:tauri-linux-v1`. Eget GitHub Actions-flöde (`.github/workflows/tauri-runtime.yml`) verifierar att Rust, Node, Cargo, WebKitGTK och systembibliotek fungerar under en icke-root-användare, skriver en ofiltrerad Trivyrapport och blockerar publicering vid nya HIGH/CRITICAL-fynd utöver det existerande, tidsbegränsade `linux-libc-dev`-undantaget. Paketets och kernelheaders-undantagets bedömning måste omprövas före 2026-12-08.

**Verifiering:** Samma isolerade Tauri-image får köra Cargo och npm-verifiering tillsammans om ett arkiv innehåller frontend och `src-tauri/Cargo.toml`. `project_verify` sammanställer separata testresultat och rapporterar inte PASS om någon verifierare misslyckas eller saknar tester. Försök att samverifiera Cargo med Java/Gradle/Python avvisas; andra projekt använder sina existerande profiler. `project_build` stöder fortfarande val av en specifik byggrot, och Rust-binärer publiceras som Linux-artefakter; det innebär **inte** att en komplett Tauri desktop-bundle skapas automatiskt.

**Avgränsning:** En grön Rust- och frontendverifiering innebär inte att Tauri-GUI:t fungerar, att Linux .deb/AppImage installerar eller att någon Windows-/macOS-build fungerar. Komplett `tauri build --no-bundle`, paketering, GUI-test och macOS-/Windows-distribution ligger utanför LANG-003C och kräver separat verifiering. Projekt med `rust-toolchain.toml` stöds fortfarande inte enligt LANG-003B:s verktygskedjepolicy.

Källor för distributionsberoenden: Tauri v2 prerequisites, https://v2.tauri.app/start/prerequisites/ . Senare Tauri CLI-build i Linux kan använda `tauri build --no-bundle` enligt https://v2.tauri.app/distribute/ .

### Releasegrind: CVE-2026-3909 i WebKitGTK (2026-11-08) och migration till Debian 13

Tauri-imagebygge och Cargo/Node/WebKitGTK-smoke passerar, och en versionspinnad npm 11.21.2 eliminerar de 41 HIGH/CRITICAL-fynd som kom från npm:s tidigare beroendeträd. Den ofiltrerade rapporten genereras fortsatt av `Tauri Runtime Image`.

**Publicering blockerad:** Den installerade Ubuntu 24.04-versionen `2.52.6-0ubuntu0.24.04.1` av WebKitGTK ger sex HIGH-fynd för samma verkliga sårbarhet, **CVE-2026-3909**, på sex relaterade WebKitGTK/JavaScriptCore-paket. Tauri v2:s officiella Linux-systemberoenden kräver WebKitGTK 4.1 för inbyggd desktopkompilering. WebKitGTK:s egen advisory WSA-2026-0006 bekräftar att versioner före 2.54.0 påverkas, och Ubuntu listar 24.04 som sårbar: https://webkitgtk.org/security/WSA-2026-0006.html respektive https://ubuntu.com/security/cves?package=webkitgtk .

Detta är **inte ett falsklarm**. Vi gör inget generellt eller tillfälligt undantag i Trivy för det. När Ubuntu erbjuder säkerhetspatchat WebKitGTK (eller en betrodd, versionslåst >=2.54.0-kompatibel uppdatering), bygg om Tauri-imagen och kör alla image-, smoke- och sårbarhetstester tills de är gröna. Mergning av LANG-003C bör invänta ett uttryckligt säkerhetsbeslut. Rust-v1, Playwright och Java/Node-bilderna påverkas inte av denna Tauri-specifika spärr.


### LANG-003C säkerhetsåtgärd – Debian 13 (2026-11-09)

För att åtgärda blockeraren i Ubuntu 24.04 har PR:n ändrats till att använda `debian:trixie-slim` (Debian 13) som operativsystemsbas. Rust 1.99.1, Clippy, rustfmt och Cargo kopieras från den publicerade, versionslåsta Rust-imagen (`rust-v1`) utan att ärva dess Ubuntu-runtimepaket. Node 22.21.1 kopieras från den fasta Node-bilden; npm uppgraderas till 11.21.2. Tauri-beroenden installeras från Debians signerade arkiv och imagebygget kontrollerar WebKitGTK, Ayatana, librsvg och libxdo.

`tauri-runtime/smoke.sh` verifierar uttryckligen Debian 13 och `pkg-config --modversion webkit2gtk-4.1` **minst 2.54**, utöver Cargo, Node, Clippy, kompilering och icke-root-körning. Uppfyllda versionskrav är inte i sig ett frikännande: den blockerande Trivy-skanningen måste också passera utan generella undantag för WebKitGTK. CI publicerar ingen Tauri-image om detta inte är uppfyllt.

Den historiska beskrivningen av Ubuntu/WebKitGTK ovan redovisar varför bytet behövdes, inte det aktuella OS-innehållet i den nya imagen.


### Verifiering av Debian 13-varianten – 9 november 2026

GitHub Actions [Tauri Runtime Image #42562591711](https://github.com/erland/agent-workspace/actions/runs/42562591711) byggde den nya Debian 13-imagen och slutförde icke-root-smoketestet. Imagen hämtade WebKitGTK **2.54.0-1~deb13u3** från Debian Security, och `smoke.sh`:s gräns minst 2.54 passerade. Den ursprungliga Ubuntu/WebKitGTK-versionen 2.52.6 finns inte längre i basimagen.

**Den blockerande säkerhetsskanningen fallerade ändå:** Trivy rapporterade **225 HIGH/CRITICAL-fynd (215 HIGH, 10 CRITICAL)** mot andra Debian 13-systempaket, exempelvis `libsoup-3.0`, `util-linux`, `curl` och andra bibliotek. Den rapporten behöver CVE-för-CVE-granskning, kontroll mot Debians advisory/backport-status och eventuellt ytterligare uppdateringar eller borttagning av onödiga paket. Det finns i nuläget **ingen verifierad säkerhetsgodkänd Tauri-image**. Vi har inte utökat Trivy-undantagen; kritiska libsoup-fynd kan vara relevanta för en webview-baserad applikation och får inte rutinmässigt ignoreras.

I PR #68 är **kod-CI och ordinarie Security Scan gröna**, men **Tauri Runtime Image har FAIL**. PR:n ligger kvar som Draft och ska inte mergas eller publiceras innan återstående blockerande sårbarheter är omhändertagna eller ett separat, uttryckligt riskbeslut är dokumenterat. Versionskravet för WebKitGTK är nödvändigt men inte ett fullständigt säkerhetsgodkännande.

### LANG-003C säkerhetsinventering och reducerad byggimage (9 november 2026)

Fortsatt säkerhetsarbete görs **utan att lägga till undantag** för `libsoup`, WebKitGTK eller övriga Debian-paket. I senaste verifierade Debian 13-image fanns **225 HIGH/CRITICAL-rapporterade fynd**, men en och samma CVE kan förekomma flera gånger därför att bibliotek och tillhörande `-dev`, GObject introspection och `-common` paket får var sin rapportpost. Dubblering är inte ett säkerhetsfrikännande. Prioritera särskilt kritiska heap buffer overflow/HTTP/WebSocket-fynd i libsoup och dokumentera om respektive CVE påverkar faktisk Tauri-process eller bara ett ej exponerat byggverktyg. Debian-backport, åtgärdsstatus och reell exponering behöver kontrolleras per CVE.

Som ett första, reversibelt minimeringssteg har `python3-pip`, `python3-venv` och `wget` tagits bort från den explicit installerade Tauri-beroendelistan. Dessa behövs inte för den planerade Cargo/npm-verifieringen. `python3` och build-verktyg behålls för befintliga sandbox-/artefaktfunktioner. Att ett paket inte längre installeras explicit garanterar inte att det försvinner: transitive dependencies avgör och **verifieras i genererad paketlista**.

CI genererar nu `tauri-image-package-inventory` med faktisk `dpkg-query`-inventering och `apt-mark showmanual`, samt `tauri-trivy-triage` (JSON + Markdown). Sammanställningen grupperar råa Trivyposter per CVE, paket, allvarlighetsgrad, status och eventuellt rapporterad `FixedVersion`. Den råa Trivyrapporten sparas oförändrad. **Ingen gruppning eller reducering av dubbleringar påverkar den blockerande Trivy-skanningen**, som måste ge PASS innan publicering. Komponenterna testas med syntetiska fixturedata i image-workflowet innan tidskrävande Dockerbygge.

Rekommenderad fortsatt prioritering: (1) använd rapporten för att lokalisera CVE:er med kända fixversioner; (2) pröva patchade Debian security/backports där de finns utan att kringgå APT-signaturer; (3) minimera återstående icke-nödvändiga paket; (4) utför fördelad hotanalys för libsoup, WebKitGTK, TLS och nätverksbibliotek; (5) kräv säkerhetsgodkänt image-jobb innan PR lämnar Draft.

### Kontroll mot Debians säkerhetstracker (9 november 2026)

Den offentliga säkerhetstrackern bekräftar att **libsoup3 i Debian trixie är listad som sårbar** för flera av de viktigaste CVE:erna, inklusive `CVE-2026-102560`, och i nuläget inte har en DSA-baserad fix i den stabila utgåvan. Se https://security-tracker.debian.org/tracker/source-package/libsoup3 . Red Hats analys av `CVE-2026-102560` anger förutsättningarna: WebSocket `permessage-deflate` måste förhandlas och ett mycket stort utgående meddelande komprimeras; begränsning av storlek eller avaktivering av komprimering kan reducera exponering i applikationen, men får **inte** betraktas som en patchad byggimage eller kringgå säkerhetsgrinden. Se https://access.redhat.com/security/cve/cve-2026-102560 .

Debians tracker visar även flera öppna `util-linux`-CVE:er för trixie, t.ex. `CVE-2026-76642` (`no-dsa`; åtgärdad i Debian unstable men inte i trixie). Se https://security-tracker.debian.org/tracker/source-package/util-linux och https://security-tracker.debian.org/tracker/CVE-2026-76642 . Att en CVE är markerad `no-dsa` betyder **inte** att paketet är åtgärdat eller att fyndet generellt kan ignoreras. Vi ska inte blanda in unstable-paket i en stabil sandboximage utan fullständig kompatibilitets- och säkerhetsgranskning.

Konsekvens: enbart `apt-get upgrade` kan i dag inte förväntas eliminera alla Tauri-relaterade CVE:er. Säkerhetsgrinden står kvar; nästa beslut bör utgå från faktisk exponeringsyta och/eller en uppströms patchad libsoup/GTK-stack, med en dokumenterad säkerhetsbedömning. Inga säkerhetsundantag har skapats i detta steg.

### LANG-003C: Isolerad utvärdering av säkerhetsuppdaterad libsoup-källa (9 november 2026)

En versionsuppdatering av `libsoup` bedöms vara den mest konkreta vägen att angripa flera kritiska WebSocket-/HTTP-fynd. Debian 13 stable (trixie) har källpaketet `libsoup3` 3.6.5-3 och flera öppna CVE:er. Debian unstable har däremot bytt **källpaketets namn** till `libsoup` och tillhandahåller bland annat 3.8.1-1; dess tidigare 3.8.0-utgåva omfattar patchar för ett flertal berörda CVE:er. Att byta hela Debian-basen till unstable eller installera unstable-binärer i releaseimagen vore ett betydligt större drift- och säkerhetsmässigt risktagande. Därför görs i stället en **separat, endast utforskande källkodsbyggning**.

`.github/workflows/tauri-libsoup-backport-evaluation.yml` kör `tauri-runtime/evaluate-libsoup-backport.sh` i en separat Debian 13-container. Skriptet:
- hämtar enbart **källkod** från Debians signerade unstable-arkiv, kräver minst 3.8.0 och sparar den faktiskt hämtade versionens SHA256;
- installerar byggverktyg och beroenden bara från Debian 13 stable och signerat trixie-backports (bland annat debhelper 14), **aldrig binärpaket från sid**;
- försöker bygga Debianpaket och sparar logg och eventuell byggartefaktlista i GitHub Actions, med tydligt PASS eller FAIL.

Den historiska källan `libsoup3=3.8.0-3` var inte längre tillgänglig från aktuellt sid-källindex. Utvärderingen justerades till källpaketet `libsoup`, och en körning verifierade att den signerade källversionen **3.8.1-1** gick att hämta och att dess byggberoenden gick att installera. Första paketeringsförsöket stoppades av `dh_gnome_clean` innan kompilering och har därför fått en ny `dpkg-buildpackage -nc`-variant som undviker det steget. **Hämtad källa eller framgångsrik kompilering är inte ett bevis för säkerhet eller kompatibilitet med WebKitGTK.**

Denna utvärdering muterar inte `tauri-runtime/Dockerfile`, ändrar **inga** befintliga Trivy-undantag och publicerar **inte** experimentella paket. Ett eventuellt fungerande backport behöver därefter en separat, verifierbar kandidatimage med ABI-test, verklig Tauri-kompilering, paketinventering, SBOM och full blockerande säkerhetsskanning. Övriga kritiska Debianfynd kvarstår även om libsoup åtgärdas.

Källreferenser: https://packages.debian.org/source/sid/libsoup , https://sources.debian.org/src/libsoup3/3.8.0-3/ , https://security-tracker.debian.org/tracker/source-package/libsoup3 .

### Utfall av libsoup-backportens byggbarhet (9 november 2026)

**PASS – källkodsbygge, inte säkerhetsgodkännande.** GitHub Actions [Tauri libsoup backport feasibility #42568137595](https://github.com/erland/agent-workspace/actions/runs/42568137595) hämtade Debian unstable-källpaketet `libsoup` **3.8.1-1**, med sparad faktisk källversion och SHA256-värden. Byggberoendena kom från trixie och trixie-backports; inga Debian sid-binärer installerades. Efter att det felande `dh_gnome_clean`-steget kringgåtts med `dpkg-buildpackage -nc` byggdes bland annat `libsoup-3.0-0`, `libsoup-3.0-common`, `libsoup-3.0-dev`, `gir1.2-soup-3.0` och tests-/debugpaket med version 3.8.1-1.

GitHub Actions-artefakten `tauri-libsoup-backport-feasibility` innehåller bygglogg, källversionsfil, källchecksummer och paketförteckning, **inte färdiga paket för distribution**. Denna källkodsbyggning har **inte** validerat ABI- och runtidskompatibilitet med Debian 13:s WebKitGTK, verkliga Tauri-byggen eller frånvaro av CVE:er enligt Trivy. PR #68 är därför fortsatt Draft; den befintliga imagebygg- och säkerhetsgrinden ändras inte.

Nästa säkra steg är att skapa en **separat kandidatimage för test**, installera de byggda Debianpaketen där med kontrollerad beroendelösning och testa (1) dynamiska bibliotek/ABI, (2) WebKitGTK 4.1 och faktiskt Tauri-projekt, (3) nytt komplett Trivyresultat med jämförbar CVE-lista mot Debian 13-baslinjen. Kandidaten får inte publiceras som `tauri-linux-v1` innan övriga blockerande sårbarheter har lösts eller formellt riskbedömts.

## LANG-003C beslut: Ubuntu 24.04 och tidsbegränsat build-only-undantag (9 november 2026)

**Detta beslut ersätter Debian 13-experimentet och tidigare rekommendation att hålla Tauri-releasen blockerad enbart på grund av CVE-2026-3909.** Den dedikerade Tauri-imagen bygger återigen direkt på det publicerade Ubuntu 24.04-baserade `rust-v1`, kompletterat med Node 22.21.1, npm 11.21.2 och Tauri v2:s bibliotek från Ubuntus signerade paketarkiv. Rust-, Java/Node- och Playwright-profilerna påverkas inte. Experimenten med Debian 13 och `libsoup` finns kvar som spårbar historik och ett **manuellt** utvärderingsflöde, men inga ombyggda paket installeras eller publiceras.

### Avgränsning av den accepterade risken

- Endast **CVE-2026-3909** för de sex exakta paketen `gir1.2-javascriptcoregtk-4.1`, `gir1.2-webkit2-4.1`, `libjavascriptcoregtk-4.1-0`, `libjavascriptcoregtk-4.1-dev`, `libwebkit2gtk-4.1-0` och `libwebkit2gtk-4.1-dev` omfattas. Detta är en känd HIGH-sårbarhet enligt WebKitGTK:s WSA-2026-0006. Den anses **inte åtgärdad** av vår kontroll eller isolering.
- Undantaget finns **bara** i `tauri-runtime/trivy-temporary-policy.rego`; det lägger till denna enda CVE till det äldre, separata `linux-libc-dev`-undantaget. Ingen annan CVE, inget annat paket och inga secret-fynd får undantas. Den fullständiga, ofiltrerade JSON-rapporten lagras även när blockerande skanning passerar.
- WebKitGTK-undantaget löper ut efter **9 december 2026** och det tidigare `linux-libc-dev`-undantaget efter **8 december 2026**. Båda kontrolleras av ett oberoende steg i GitHub Actions; efter deadline stoppas publicering även om Trivy-reglerna finns kvar. Förlängning kräver ny explicit säkerhetsbedömning och uppdaterad PR.
- Om Ubuntu publicerar en säkerhetskorrigerad WebKitGTK-version, bygg om från uppdaterade arkiv, granska Trivy-resultatet och ta bort undantaget utan att invänta deadline. Källor: https://webkitgtk.org/security/WSA-2026-0006.html och https://ubuntu.com/security/CVE-2026-3909 .

### Driftbegränsningar

Denna profil är en **isolerad, icke-root, temporär Linux-byggsandbox**, inte en säker eller godkänd grafik-/webbläsarruntime. `tauri-runtime/Dockerfile` sätter `DISPLAY` och `WAYLAND_DISPLAY` till tomma strängar samt `GDK_BACKEND=none`. Standard-smoken verifierar detta och gör endast Cargo-, Node- och systembibliotekskontroller; inga GUI-, WebView-, Xvfb-, webbläsar- eller externa webbsidestester ingår. En projektskript-/testprocess kan teoretiskt ändra miljövariabler eller försöka starta en GUI-process. Miljövariabler är därför **inte en hård säkerhetsgräns**. Sandboxes får inte exponerar någon grafisk display/server och ska fortsätta ha kort livslängd, icke-root-användare, process-/resursgränser och nätverksrestriktioner. Projektkod är fortfarande opålitlig.

Denna riskacceptans gäller **enbart build/check/test utan avsiktlig WebKitGTK- eller GUI-körning**. Om sådana testfall krävs, eller om säkerhetsskanningen rapporterar andra blockerande fynd, ska denna profil inte användas för dem och publicering ska stoppas eller ett separat dokumenterat riskbeslut tas.

### Återgång och releasegrind

GitHub Actions ska visa PASS för (1) kod-CI, (2) vanlig Security Scan, (3) fullständig Tauri-imagebuild och smoke, och (4) blockerande Trivy-scanning med den **enda** tidsbegränsade WebKitGTK-regeln och existerande kernelheaders-regeln. Då får en ny, immutable `tauri-linux-v1`-tagg publiceras från main, efter kontroll att den inte redan existerar. Ofiltrerad säkerhetsrapport och paketinventering sparas. Detta beslut är inte ett löfte om att en senare Ubuntu-patch kommer före ett visst datum.
