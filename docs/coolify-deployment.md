# Coolify deployment – DEV-015

## Målbild

`agent-workspace` kör som en vanlig Node 22-container i Coolify. PostgreSQL är extern från applikationscontainern. Alla npm/Maven/Chromium-jobb körs hos execution providern (Modal i v1).

Apphosten behöver därför **inte**:

- Docker socket,
- Docker CLI,
- Java/JDK,
- Maven,
- Chromium/Playwright,
- någon lokal build-worker.

## Build och start

Bygg från repositoryts `Dockerfile`. Imagen kör migrationer före serverstart och startar därefter `dist/mcp/remote.js`.

Standardport är `3000`. Coolify ska routa HTTPS-domänen till den porten.

### Health

- `GET /health` – liveness, kräver inte OAuth eller fungerande PostgreSQL.
- `GET /ready` – readiness, returnerar `503` om PostgreSQL inte kan nås.
- `GET /mcp` – remote MCP och kräver OAuth Bearer-token.

Använd `/health` som container/Cold-start health check. Använd `/ready` om plattformen har separat readiness-check.

## Required environment

```text
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB
AGENT_WORKSPACE_PUBLIC_BASE_URL=https://workspace.example/
AGENT_WORKSPACE_OAUTH_ISSUER=https://issuer.example/
AGENT_WORKSPACE_OAUTH_JWKS_URI=https://issuer.example/.well-known/jwks.json
```

## Recommended/conditional environment

```text
AGENT_WORKSPACE_OAUTH_AUDIENCE=https://workspace.example/mcp
AGENT_WORKSPACE_OAUTH_SCOPE=agent-workspace
AGENT_WORKSPACE_ALLOWED_EMAILS=user1@example.com,user2@example.com
AGENT_WORKSPACE_WEB_OIDC_CLIENT_ID=<oidc-client-id>
AGENT_WORKSPACE_WEB_OIDC_CLIENT_SECRET=<oidc-client-secret-if-required>
AGENT_WORKSPACE_WEB_SESSION_SECRET=<random-session-secret>
AGENT_WORKSPACE_CREDENTIAL_ENCRYPTION_KEY=<base64-32-byte-key>
AGENT_WORKSPACE_MODAL_APP_NAME=agent-workspace
HOST=0.0.0.0
PORT=3000
AGENT_WORKSPACE_VERSION=<release/version>
```

`AGENT_WORKSPACE_OAUTH_AUDIENCE` defaultar till den publika `/mcp`-URL:en. `HOST` och `PORT` har defaults.

### Pilot-allowlist

Sätt `AGENT_WORKSPACE_ALLOWED_EMAILS` till en kommaseparerad lista med de e-postadresser som får använda MCP-tjänsten under pilotfasen, till exempel `anna@example.com,bertil@example.com`. Matchning är case-insensitive och whitespace trimmas. När variabeln är satt får en giltigt autentiserad användare som saknar e-postclaim eller vars e-postadress inte finns i listan HTTP `403 Forbidden`. Om variabeln lämnas tom är allowlist-spärren avstängd.

Allowlisten ska användas under pilotfasen. Med personliga Modal credentials behöver de tillåtna användarna inte dela Modal-konto.

## Personliga Modal credentials

Normal pilotdrift använder `/settings`. Användaren loggar in via OIDC och anger sin egen Modal API Token ID + Token Secret. Agent Workspace verifierar credentialsen mot Modal innan execution account markeras `CONNECTED`.

Token-materialet krypteras med AES-256-GCM innan det lagras i PostgreSQL. `execution_account` lagrar endast en `credential_ref`. Token secret visas aldrig igen efter sparning.

Generera master key en gång och spara den som Coolify secret:

```bash
openssl rand -base64 32
```

Resultatet sätts som `AGENT_WORKSPACE_CREDENTIAL_ENCRYPTION_KEY`. Tappa inte bort eller byt nyckeln utan en planerad rotation, eftersom befintliga credentials annars inte kan dekrypteras.

Generera även en separat web session secret, exempelvis:

```bash
openssl rand -base64 48
```

och sätt den som `AGENT_WORKSPACE_WEB_SESSION_SECRET`.

Hos OIDC-providern registreras en web client med callback:

```text
https://workspace.example/settings/callback
```

Sätt client-id som `AGENT_WORKSPACE_WEB_OIDC_CLIENT_ID` och, för confidential clients, client secret som `AGENT_WORKSPACE_WEB_OIDC_CLIENT_SECRET`.

### Legacy environment credentials

Environment-baserade credentials stöds fortsatt för utveckling/bakåtkompatibilitet men rekommenderas inte för normal multi-user pilotdrift.

V1 lagrar endast `credential_ref` i PostgreSQL. Själva Modal-credentials finns server-side. För en referens som:

```text
env:modal_user_1
```

kan OAuth-credentials anges som:

```text
AGENT_WORKSPACE_CREDENTIAL_MODAL_USER_1_REFRESH_TOKEN=...
AGENT_WORKSPACE_CREDENTIAL_MODAL_USER_1_CLIENT_ID=...
AGENT_WORKSPACE_CREDENTIAL_MODAL_USER_1_CLIENT_SECRET=...
```

Alternativt stöds Modal token credentials för utveckling/övergång:

```text
AGENT_WORKSPACE_CREDENTIAL_MODAL_USER_1_TOKEN_ID=...
AGENT_WORKSPACE_CREDENTIAL_MODAL_USER_1_TOKEN_SECRET=...
```

Modal third-party OAuth är fortfarande uppskjutet; se DEV-011. Det behövs inte för att isolera pilotanvändarnas Modal-konton när varje användare konfigurerar sin egen API-token i `/settings`.

## PostgreSQL

Använd en persistent PostgreSQL-databas och TLS där providern stödjer det. Vid containerstart körs SQL-migrationer från `db/migrations` under PostgreSQL advisory lock. Redan applicerade migrationer spåras i `schema_migration`.

Applikationscontainern lagrar inga projektfiler permanent. Workspace-data ligger i sandbox-providern och metadata i PostgreSQL.

## Coolify-konfiguration

1. Skapa PostgreSQL-resurs eller använd extern PostgreSQL.
2. Skapa Application från Git-repot och välj Dockerfile build pack.
3. Lägg in environment variables/secrets ovan.
4. Exponera port `3000` via önskad HTTPS-domän.
5. Ange health path `/health`.
6. Deploya.
7. Verifiera `/health` = 200 och `/ready` = 200.
8. Registrera OIDC web client med callback `/settings/callback` och verifiera inloggning till `/settings`.
9. Verifiera att en allowlistad användare kan spara/testa sin egen Modal-token och att en ej allowlistad användare nekas.
10. Verifiera OAuth protected-resource metadata och därefter `/mcp` med giltigt token.
11. Verifiera att MCP-exekvering använder respektive användares personliga Modal-konto.

## Säkerhetsgräns

Montera **inte** `/var/run/docker.sock`. Lägg inte Java, Maven eller browser i applikationsimagen. Modal/annan `SandboxProvider` är den enda platsen där användarprojekt får exekveras.

Containerfilsystemet ska betraktas som ephemeral. Backuper gäller PostgreSQL samt separat credential-store när env-credentials senare ersätts av en riktig secrets backend.
