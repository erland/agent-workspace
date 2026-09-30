# DEV-012 verification – multi-user identity and PostgreSQL persistence

## Implemented

- Provider-neutral repository interfaces for User, ExternalIdentity, ExecutionAccount and Workspace.
- PostgreSQL schema migration in `db/migrations/001_identity_workspace.sql`.
- PostgreSQL repository implementations using parameterized SQL.
- `IdentityService` resolves `(issuer, subject)` to one internal user.
- Exactly one execution account is persisted per user in v1 (`unique(user_id)`).
- Credential material is **not** stored in PostgreSQL; only `credential_ref` is persisted.
- Workspace metadata includes `user_id` and is fetched through an ownership-scoped query.
- `WorkspaceService` can persist and rehydrate provider workspace handles after process restart.
- Persisted READY workspaces can be found for expiry cleanup.
- Repository-backed `get_profile` provider is available for DEV-013 wiring.

## Local provider-neutral verification

Run:

```bash
npm test
npm run typecheck
npm run build
```

## PostgreSQL smoke

Start a disposable PostgreSQL instance if needed:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
export DATABASE_URL='postgres://agent:agent@localhost:5432/agent_workspace'
npm run smoke:persistence
```

Or run the complete step verification:

```bash
export DATABASE_URL='postgres://agent:agent@localhost:5432/agent_workspace'
npm run verify:dev012
```

The smoke applies the idempotent migration, creates two isolated users and execution-account references, verifies workspace ownership and expiry lookup, then deletes the temporary users (cascading dependent rows).

## Security boundary

PostgreSQL stores only `credential_ref`. OAuth refresh tokens / Modal tokens remain the responsibility of the server-side credential store introduced in DEV-011. This prevents database persistence from silently becoming a raw secret store.

## Pending

DEV-011 live Modal OAuth verification remains blocked on provider-issued OAuth integration credentials. DEV-012 does not remove that blocker.
