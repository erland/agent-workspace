# DEV-011 – Auth/account-linking feasibility spike

## Goal

Verify the production shape for mapping one Agent Workspace user to exactly one execution account and constructing a Modal client with that user's credentials. V1 supports only Modal, but credentials are resolved through a provider-neutral execution-account boundary.

## Confirmed from Modal documentation

Modal's current JavaScript SDK accepts both ordinary API-token credentials and OAuth credentials directly in `new ModalClient(...)`. The OAuth form consists of a Modal-issued OAuth client id, Modal-issued OAuth client secret, and the individual user's refresh token. Modal's Python documentation explicitly describes this mode as suitable for managing Modal on behalf of third-party users.

The implementation therefore uses this production shape:

```text
Agent Workspace user
      |
      v
ExecutionAccount(provider=modal, credentialRef=...)
      |
      v
server-side credential store
      |
      v
ModalSandboxProvider dedicated to that account
      |
      v
new ModalClient({
  oauthRefreshToken,
  oauthClientId,
  oauthClientSecret
})
```

Credentials are never put into workspace metadata, MCP tool results, sandbox environment variables, or uploaded project files.

## Credential lifecycle decision

- `ExecutionAccount` stores only a `credentialRef`, never the refresh token itself.
- The secret backend introduced with persistence must encrypt the refresh token at rest or delegate storage to an external secret manager.
- A provider instance is created for the resolved execution account, preventing accidental reuse of a singleton Modal client across users.
- `DISCONNECTED` and `REVOKED` execution accounts are rejected before provider creation.
- Disconnect/revoke in Agent Workspace must delete/invalidate the locally stored refresh token. Provider-side revocation must use Modal's supported revocation mechanism once the integration registration details are supplied by Modal.
- Access tokens, refresh tokens, client secrets and API tokens must never be logged.

## Live two-user isolation smoke

The repository includes `npm run smoke:modal-accounts`. It requires a Modal-issued OAuth integration plus two refresh tokens from two different Modal test identities.

Set:

```bash
export AGENT_WORKSPACE_MODAL_OAUTH_CLIENT_ID='oc-...'
export AGENT_WORKSPACE_MODAL_OAUTH_CLIENT_SECRET='ov-...'
export AGENT_WORKSPACE_TEST_USER1_MODAL_OAUTH_REFRESH_TOKEN='...'
export AGENT_WORKSPACE_TEST_USER2_MODAL_OAUTH_REFRESH_TOKEN='...'
```

Then run:

```bash
npm install
npm run verify:dev011
```

The live smoke creates an independent `ModalClient` for each execution account, creates a sandbox under each identity, runs `node --version`, checks that two distinct sandbox ids are returned, and terminates both in `finally` blocks.

## Remaining external dependency

The public Modal SDK documentation confirms how to consume OAuth refresh credentials, but it does not document a self-service third-party OAuth application registration flow, authorization endpoint setup, or provider-side revocation workflow in enough detail to complete account-linking without Modal-issued integration credentials.

Therefore DEV-011 must remain `verification_pending` until:

1. Modal issues/approves an OAuth client for Agent Workspace (or documents a public registration path), and
2. two distinct Modal test users complete authorization and `npm run verify:dev011` passes.

This is an external feasibility dependency, not a reason to fall back to shared service-account credentials. For local development, the existing API-token/profile flow remains supported.
