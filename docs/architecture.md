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
