# Architecture Decision Log

## ADR-001 – Modal som enda execution provider i v1

**Status:** Accepted

V1 implementerar endast Modal. Provider-kopplingen abstraheras genom `SandboxProvider` så att framtida användare kan ligga på andra providers utan att MCP-kontraktet behöver ändras.

En användare har exakt en execution provider/account, inte flera samtidiga providers.

## ADR-002 – Node 22 / TypeScript för agent-workspace

**Status:** Accepted

Backend/MCP-server utvecklas i TypeScript på Node 22. Sandbox runtimes är separata från backend runtime.

## ADR-003 – Runtime defaults

**Status:** Accepted

- Java 21 default; stöd för 17, 21, 25 i v1.
- Node 22 default; stöd för 20, 22 i v1.

## ADR-004 – Ingen generell publik shell exec i v1

**Status:** Accepted

V1 exponerar högre nivåns build/prototype-tools. Intern provider exec finns men generell publik shell-tool skjuts på framtiden.

## ADR-005 – Coolify hostar endast tjänstelagret

**Status:** Accepted

Appservern kör `agent-workspace` och senare PostgreSQL. Build/test/browser-exekvering körs hos execution provider. Ingen Docker socket ska krävas på appservern.

## ADR-006 – Runtime profiles use provider-controlled bootstrap in early v1

**Status:** Accepted for DEV-002

The logical runtime profile remains provider-neutral. The initial Modal implementation starts from
`eclipse-temurin:<java>-jdk-noble` and installs Maven plus Node 20/22 in the sandbox using a controlled
bootstrap command. This avoids requiring six pre-published images during early development.
Prebuilt named images may replace the bootstrap later for faster startup without changing the
workspace or MCP contracts.

## MCP ZIP transport in DEV-010

Standard MCP tool arguments are JSON, while the product needs to accept ZIP binaries. DEV-010 uses `archiveBase64` as the portable contract for the initial stdio/MCP proof. This is intentionally isolated in the MCP adapter. Before remote production use, validate ChatGPT and Claude large-file ergonomics and consider staged upload/resource links so the core `WorkspaceService.uploadZip(Uint8Array)` does not change.

## ADR-006 – One execution account per user; per-user Modal client

**Status:** Accepted for v1 design, live OAuth verification pending.

Each Agent Workspace user has exactly one `ExecutionAccount`. V1 accepts only `provider=modal`. The account stores a provider account identifier when available plus a `credentialRef`; provider secrets are resolved server-side at call time.

A Modal client must be constructed per execution account rather than held as one application-wide singleton. Production account linking uses Modal OAuth refresh credentials. Local development may continue to use a developer token/profile. This keeps each user's Modal quota/billing isolated and keeps the MCP/API contract independent of the execution provider.

## ADR – Agent Workspace is an OAuth resource server

**Decision:** `agent-workspace` will not issue end-user OAuth tokens. The remote MCP endpoint is an OAuth 2.1 resource server and delegates authorization to an established external identity provider.

**Rationale:** MCP v2 and ChatGPT's remote MCP integration expect standards-based OAuth discovery and bearer-token validation. Keeping authorization-server responsibility outside Agent Workspace avoids building account/password/token issuance infrastructure and keeps the same service usable from ChatGPT, Claude and other MCP clients.

**Identity key:** the durable Agent Workspace identity is resolved from the validated token's `(issuer, subject)` pair. Client identity is not used as the user key.

**Credential boundary:** end-user bearer tokens are used only to authenticate the request. Modal credentials remain server-side behind `ExecutionAccount.credentialRef` and are never exposed in MCP responses or injected into sandboxes.

## ADR-014 – Security baseline for untrusted project execution

**Decision:** Public/multi-user v1 enforces fixed workspace resource limits, a maximum of three active workspaces per user, per-operation rate limiting, bounded/redacted logs, persisted TTL cleanup, structured audit events and a dependency-domain outbound allowlist. Provider/server credentials are never injected into sandboxes.

**Rationale:** Uploaded npm/Maven projects can execute arbitrary code through build scripts and plugins. The sandbox therefore has to be treated as hostile even when the top-level command is server-controlled.

**Trade-off:** A restrictive dependency-domain policy may reject legitimate projects that depend on custom/private repositories. V1 prefers an explicit failure over silently granting unrestricted egress; configurable repository policies can be added later.


## ADR-015 – Separate build, preview, and browser-rendering responsibilities

**Status:** Accepted

**Decision:** Agent Workspace owns temporary execution, project verification, project build, and artifact publication. PWA Preview owns static preview publication and preview lifecycle. Browser Screenshot owns browser rendering and screenshot presentation.

The target Agent Workspace MCP surface therefore excludes the current `prototype_start`, `prototype_preview_link`, `prototype_screenshot`, `prototype_screenshot_gallery`, and `prototype_stop` tools once migration prerequisites are complete.

The supported cross-service handoff is:

```text
Agent Workspace project_build
  -> artifact_download_link
  -> PWA Preview preview_create(sourceUrl)
  -> preview URL
  -> Browser Screenshot screenshot_create
```

**Rationale:** The three services currently overlap around prototype hosting and screenshot capture. Keeping those concerns in Agent Workspace duplicates browser/runtime code, makes MCP tool selection less clear, and keeps execution sandboxes alive for work that dedicated services can perform more efficiently.

**Migration constraint:** This ADR defines the target state only. Prototype tools remain available until `project_build` output handling and the signed artifact handoff to PWA Preview are verified. Removal is intentionally staged to avoid breaking the existing end-to-end workflow.

See `docs/service-boundaries.md` for the detailed responsibility split and migration order.
