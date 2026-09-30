# DEV-013 verification – OAuth-protected remote MCP

## Implemented

- Remote MCP endpoint `/mcp` using MCP v2 `createMcpHandler`.
- Bearer-token gate via MCP `requireBearerAuth`.
- RFC 9728 protected-resource metadata at `/.well-known/oauth-protected-resource/mcp`.
- JWT verification using issuer, audience, expiry and remote JWKS (`jose`).
- Authenticated principal maps `issuer + subject` to `IdentityService` / persisted `User`.
- Per-request tool service is bound to exactly one Agent Workspace user.
- Workspace access remains user-scoped through `WorkspaceRepository.findByIdForUser`.
- `get_profile` returns Agent Workspace identity and execution connection status, never bearer tokens or provider credentials.
- Environment credential-store implementation keeps execution credentials server-side.
- Remote server is an OAuth resource server only; an external identity provider remains the authorization server.

## Local checks performed in the constrained environment

- All TypeScript source/test files: syntax/transpile check PASSED (`tsc --noCheck`).
- `test/auth.test.ts`: 3/3 PASSED.
- `test/authenticated-tool-service.test.ts`: 3/3 PASSED.
- Covered:
  - protected-resource metadata,
  - HTTPS requirement outside localhost,
  - token not copied into application principal,
  - stable issuer+subject identity resolution,
  - execution denied before an execution account is connected,
  - user B cannot destroy user A's workspace.

## Pending full verification

The current execution environment cannot complete `npm install`, so the actual MCP/Jose packages could not be typechecked or executed here.

On a development machine:

```bash
npm install
npm run verify:dev013
```

`verify:dev013` runs the full unit suite, typecheck, build and a real Streamable HTTP smoke using two bearer identities. It verifies an unauthenticated request receives 401 and that two authenticated identities resolve to distinct Agent Workspace users.

A production identity provider still needs to be selected/configured before ChatGPT/Claude interactive OAuth can be acceptance-tested.
