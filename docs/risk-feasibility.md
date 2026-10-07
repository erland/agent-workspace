# Risk and Feasibility – agent-workspace v1

## Verifierad feasibility

En separat Modal-PoC har verifierat följande end-to-end:

- Modal Sandbox startar under gVisor,
- Node 22 och npm fungerar,
- npm kan hämta dependencies,
- Vitest kan köras,
- Vite kan bygga,
- Java/Maven kan köras och hämta dependencies,
- Chromium finns och kan köras headless,
- Playwright kan styra Chromium,
- Vite-prototyp kan startas och nås lokalt,
- screenshots för desktop/tablet/mobile kan hämtas tillbaka till klienten.

PoC-resultatet var PASS för Node, Maven och det dåvarande prototype-flödet. Prototype/screenshot-funktionerna har senare flyttats ut ur Agent Workspace; Browser Screenshot äger browser-runtime och PWA Preview äger preview-livscykel.

## Huvudrisker

### R-001 – Per-user Modal account linking
**Risk:** exakt produktionsflöde för tredjeparts account linking/credential lifecycle måste verifieras innan auth-delen låses i kod.

**Åtgärd:** implementera initiala development steps med en explicit dev credential-konfiguration. Gör en separat riskreducerande auth/account-linking-spike innan multi-user auth färdigställs.

### R-002 – Runtime image matrix
**Risk:** sex kombinationer av Java/Node kan ge image-underhåll och cachekostnad.

**Åtgärd:** modellera runtime-profiler provider-neutralt och börja med defaultprofilen Java 21 + Node 22. Lägg till övriga profiler stegvis med samma kontrakt.

### R-003 – Opålitliga projekt
**Risk:** `npm install`, Maven plugins och testkod kan köra godtycklig kod.

**Åtgärd:** all projektkod körs i sandbox provider. Server credentials skickas aldrig in i sandboxen. CPU/minne/TTL/timeout begränsas.

### R-004 – Nätverksexfiltration
**Risk:** opålitlig kod kan använda outbound network.

**Åtgärd:** v1 börjar med providerens säkra sandbox-isolering och inga server-secrets i sandboxen. Network allowlisting planeras som senare hardening om den inte behövs tidigare för release.

### R-005 – Artifact handoff
**Risk:** externa preview/deployment-tjänster måste kunna hämta build-output utan att få tillgång till Agent Workspace-interna resurser eller credentials.

**Åtgärd:** använd kortlivade signerade HTTPS-länkar från `artifact_download_link` och håll preview/browser-funktioner i separata tjänster.

### R-006 – Workspace recovery
**Risk:** backend restart medan Modal sandbox lever kan ge stale metadata.

**Åtgärd:** persist workspace metadata när persistence introduceras och bygg reconciliation/expiry mot faktisk provider-status.
