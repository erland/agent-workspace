# Functional Specification – agent-workspace v1

## 1. Syfte

`agent-workspace` ska ge AI-assistenter en säker, tillfällig remote workspace där kodprojekt kan byggas och testas utan att klienten själv behöver ha Java, Node eller Maven.

## 2. Aktörer

- **Användare** – personen som använder ChatGPT, Claude eller annan kompatibel klient.
- **AI-assistent** – MCP/API-klient som arbetar på användarens uppdrag.
- **Execution provider** – sandbox-tjänst där kod exekveras. V1 stödjer endast Modal.

## 3. Must-scope v1

### FR-001 – Capabilities
Tjänsten ska kunna rapportera vilka runtimes, build systems och artifact-funktioner som stöds.

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

### FR-015 – Python project discovery (PY-001)
Tjänsten ska identifiera Python-projekt via `pyproject.toml`, `requirements.txt` och `uv.lock`, inklusive undermappar och blandprojekt. Flera Python-manifest i samma katalog räknas som ett projekt. Identifiering innebär inte att Python-kod kan verifieras eller byggas i detta steg. `get_capabilities` skiljer därför `projectDetection` från körbara `buildSystems`. Python i ett blandprojekt får inte tyst ignoreras med ett sammanlagt PASS.

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

### FR-016 – Python verification (PY-002)
Python-projekt med eget projektroot ska verifieras i en ephemeral Modal-sandbox med isolerad virtuell miljö. `requirements.txt` och/eller `pyproject.toml` används vid installation. `uv.lock` utan requirements-fil ger BLOCKED tills uv-stöd implementerats. Kör pytest om installerad, annars unittest discovery. Saknade tester eller omöjlig testidentifiering ska ge BLOCKED, aldrig PASS. Pip-installationsfel ger FAILED med begränsade/redigerade loggar. Blandprojekt kräver explicit projectRoot tills PY-003.

### FR-017 – Coordinated mixed-project verification (PY-003)
För ZIP-projekt som kombinerar Python med npm och/eller Maven ska `project_verify` automatiskt verifiera samtliga identifierade byggsystem i en och samma tillfälliga sandbox. Delresultat ska innehålla projektrot, byggsystem, steg, status och felinformation. Sammanlagt PASS får endast rapporteras när alla obligatoriska delverifieringar är PASS. Om någon del är FAILED blir helheten FAILED; annars blir den BLOCKED om någon del är BLOCKED. Kända Maven-reaktormoduler ska inte dubbelverifieras när en överordnad Maven-rot redan täcker dem. Vid explicit `projectRoot` begränsas verifieringen till den valda katalogens manifest. Denna funktion omfattar inte Python-byggartefakter.

### FR-019 – Gradle-project discovery, verification and builds (LANG-002)
Tjänsten identifierar Gradle-projekt via `build.gradle` och `build.gradle.kts` (en projektrot även när båda finns), i undermappar och blandprojekt. Java-toolchain-version kan härledas ur explicit `JavaLanguageVersion.of(...)`. För verifiering krävs en komplett Gradle Wrapper (`gradlew`, `gradle/wrapper/gradle-wrapper.jar`, `gradle/wrapper/gradle-wrapper.properties`); `project_verify` kör `bash ./gradlew --no-daemon --console=plain clean test`, kontrollerar att minst ett test finns i genererade XML-rapporter och ger BLOCKED om wrappern eller verifierade testresultat saknas samt FAILED om tester fallerar. `project_build` kör `assemble`, hittar JAR/WAR i underprojektens `build/libs` och publicerar dem via samma artefakthantering som Maven; saknat wrapper eller utebliven JAR/WAR är byggfel. Gradle laddas ned av projektets wrapper till isolerad sandbox; ingen global Gradle-installation eller ny runtimebild behövs. Android-byggen som kräver Android SDK, samt Gradle-projekt utan wrapper, ingår inte.

### FR-009 – Structured verification result
Verifiering ska returnera minst:
- `PASSED`, `FAILED` eller `BLOCKED`,
- projekttyp,
- vald runtime,
- utförda steg,
- exit code,
- duration,
- failure summary och relevant log excerpt vid fel.

### FR-010 – Build artifacts
Tjänsten ska kunna bygga npm-, Maven- och paketerbara Python-projekt och publicera explicit valda eller autodetekterade outputs som tillfälliga artifacts. En output-path får peka på en fil eller katalog; kataloger paketeras för portabel handoff.

### FR-018 – Python package builds (PY-004)
Tjänsten ska kunna bygga standardiserade Python-paket med `pyproject.toml` och PEP 517 via `project_build`. Byggningen körs endast i en sandbox med en separat venv och ett versionsbundet Python-buildverktyg. Projektets egna build-backendberoenden hanteras av PEP 517 och får inte installeras på applikationsservern. Vid lyckad byggning ska wheel (`.whl`) och sdist (`.tar.gz`) automatiskt identifieras och kunna publiceras med korrekt filnamn och MIME-typ. Explicita säkra filvägar stöds. Ett projekt som endast innehåller `requirements.txt` är inte ett paketerbart Python-projekt och ska därför få ett tydligt byggfel. Utebliven eller misslyckad paketering får aldrig rapporteras som PASS.

### FR-011 – Artifact handoff
Tjänsten ska kunna ge en kortlivad signerad HTTPS-länk till ett publicerat artifact så att externa tjänster, exempelvis PWA Preview, kan hämta det utan MCP resource access.

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
- `workspace_upload_zip_from_url`
- `project_verify`
- `project_build`
- `artifact_get`
- `artifact_download_link`
- `workspace_destroy`

Generell publik `shell_exec`, preview-hosting och screenshot-funktioner ingår inte i Agent Workspace v1.

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
`agent-workspace` ska kunna deployas som containeriserad tjänst, med Coolify som målprofil. Java/Maven/Node ska inte krävas på applikationsservern.

## 6. Acceptance criteria v1

V1 är funktionellt accepterad när en autentiserad testanvändare med anslutet Modal-konto kan:

1. ladda upp ett npm-projekt och få korrekt PASS/FAIL,
2. ladda upp ett Maven-projekt och få korrekt PASS/FAIL,
3. välja/autoidentifiera stödd Java/Node-runtime,
4. bygga ett projekt och välja en fil eller katalog som output,
5. hämta artifact metadata och skapa en signerad download-länk,
6. få workspacet automatiskt eller explicit terminerat,
7. göra detta genom MCP-kontraktet utan provider-specifika parametrar.

## 7. Out of scope v1

- fler execution providers än Modal,
- en användare med flera samtidiga providers,
- Android SDK-baserade Gradle-byggen och Gradle-projekt utan fullständig wrapper,
- pnpm/yarn,
- Conda-, Poetry- och uv-specifika Python build workflows (wheel/sdist via PEP 517 ingår från PY-004),
- Git repository integration,
- CI/CD-plattform,
- permanent project hosting,
- team sharing,
- publik generell shell-tjänst,
- egen build farm eller Docker socket på appservern.
