# Coolify deployment – DEV-015

## Målbild

`agent-workspace` kör som en vanlig Node 22-container i Coolify. PostgreSQL är extern från applikationscontainern. Alla npm/Maven/Chromium-jobb körs hos execution providern (Modal i v1).

Rekommenderad nätverkstopologi:

```text
Internet
   |
   | HTTPS :443
   v
Coolify reverse proxy (Traefik)
   |
   | internt Docker-nätverk
   v
Agent Workspace :3000
   |
   | DATABASE_URL
   v
Separat PostgreSQL
```

Lägg **inte** in Nginx i Agent Workspace-containern. Coolifys reverse proxy terminerar TLS och routar trafiken vidare till Node-processen. Node-port `3000` ska inte publiceras som host-port.

Apphosten behöver därför **inte**:

- Docker socket,
- Docker CLI,
- Java/JDK,
- Maven,
- Chromium/Playwright,
- någon lokal build-worker.

## Build och start

Bygg från repositoryts `Dockerfile`. Imagen kör migrationer före serverstart och startar därefter `dist/mcp/remote.js`.

Standardport är `3000`. Den porten är endast applikationens interna lyssningsport. Coolify ska routa den publika HTTPS-domänen via Traefik till containerport `3000`.

Använd inte explicit host-port mapping som `3000:3000`. Det skulle kringgå den rekommenderade reverse-proxyvägen och exponera Node direkt från hosten.

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

I Google Cloud Console skapas en OAuth 2.0 Client ID av typen **Web application**. Registrera exakt:

```text
https://workspace.example/auth/google/callback
```

som Authorized redirect URI. Sätt client-id och secret som `AGENT_WORKSPACE_GOOGLE_CLIENT_ID` och `AGENT_WORKSPACE_GOOGLE_CLIENT_SECRET`.

Agent Workspace utfärdar därefter egna MCP-access tokens. Generera den signerande Ed25519-nyckeln:

```bash
openssl genpkey -algorithm ED25519 -outform DER | openssl base64 -A
```

och lagra resultatet som `AGENT_WORKSPACE_AUTH_SIGNING_KEY`. Den publika nyckeln exponeras automatiskt via `/jwks`; den privata nyckeln lämnar aldrig servermiljön.

OAuth-servern exponerar bland annat:

```text
/.well-known/oauth-authorization-server
/.well-known/oauth-protected-resource/mcp
/authorize
/token
/register
/jwks
```

Dynamic Client Registration stöds för kompatibla MCP-klienter. Om en klient använder Client ID Metadata Documents måste dess HTTPS-origin först anges i `AGENT_WORKSPACE_OAUTH_CLIENT_METADATA_ORIGINS`.

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

Använd en separat persistent PostgreSQL-databas och TLS där providern stödjer det. Agent Workspace-containern innehåller ingen PostgreSQL-server och ingen separat PostgreSQL-resurs behöver skapas i Coolify om en extern databas redan finns. Vid containerstart körs SQL-migrationer från `db/migrations` under PostgreSQL advisory lock. Redan applicerade migrationer spåras i `schema_migration`.

Applikationscontainern lagrar inga projektfiler permanent. Workspace-data ligger i sandbox-providern och metadata i PostgreSQL.

## Coolify-konfiguration

1. Säkerställ att den separata PostgreSQL-databasen är nåbar från Coolify-hostens Docker-nätverk eller via dess nätverksadress.
2. Skapa Application från Git-repot och välj Dockerfile build pack.
3. Lägg in environment variables/secrets ovan, inklusive `DATABASE_URL` till den separata databasen.
4. Ange applikationens interna port som `3000` och koppla önskad `https://`-domän till applikationen.
5. Lägg inte till någon host-port mapping för `3000`.
6. Låt Coolifys Traefik-proxy hantera TLS och publik ingress på 80/443.
7. Ange health path `/health`.
8. Deploya.
9. Verifiera att `/health` = 200 och `/ready` = 200 via den publika HTTPS-domänen.
10. Registrera Google Web OAuth client med callback `/auth/google/callback`.
11. Verifiera RFC 8414 metadata, JWKS och RFC 9728 protected-resource metadata.
12. Verifiera ett fullständigt MCP Authorization Code + PKCE-flöde via Google och att lokalt utfärdad token accepteras av `/mcp`.
13. Verifiera inloggning till `/settings` med samma Google-identitet.
14. Verifiera att en allowlistad användare kan spara/testa sin egen Modal-token och att en ej allowlistad användare nekas.
15. Verifiera två användare mot två skilda Modal-konton.
16. Verifiera refresh-tokenrotation och reconnect efter service-restart.

## Säkerhetsgräns

Publik trafik ska endast gå via Coolifys reverse proxy. Exponera inte Node-port `3000` direkt från hosten.

Montera **inte** `/var/run/docker.sock`. Lägg inte Java, Maven eller browser i applikationsimagen. Modal/annan `SandboxProvider` är den enda platsen där användarprojekt får exekveras.

Containerfilsystemet ska betraktas som ephemeral. Backuper gäller PostgreSQL samt separat credential-store när env-credentials senare ersätts av en riktig secrets backend.
