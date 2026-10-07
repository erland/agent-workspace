---
name: agent-workspace
description: Use Agent Workspace when the user wants to inspect, verify, or build a source project in an isolated execution workspace and retrieve build artifacts.
---

# Agent Workspace workflow

Agent Workspace provides isolated execution for uploaded source projects. Use it for project inspection, verification, builds, and temporary build artifacts.

Preview hosting and screenshots are intentionally outside Agent Workspace. For static web applications, hand built artifacts to PWA Preview. For visual verification of a deployed URL, use Browser Screenshot when available.

## Establish the workspace

When beginning a project workflow:

1. Use `get_profile` when user/account readiness matters.
2. Use `get_capabilities` when runtime support or available build capabilities matter.
3. Create a logical workspace with `workspace_create`.
4. Upload the source archive with `workspace_upload_zip` when ChatGPT can supply an attached ZIP through file parameters.
5. Use `workspace_upload_zip_from_url` only when a public HTTPS source URL is the appropriate transport.

Do not treat source download URLs as Agent Workspace authorization. Authentication and user isolation remain enforced by the MCP connection.

## Verify and build

Use `project_verify` when the user wants to know whether the project compiles, tests, or otherwise passes its normal verification workflow.

Use `project_build` when the user needs built output or an artifact for later handoff. `outputs[].path` may select a project-relative file or directory. Files are published unchanged; directories are packaged as `.tar.gz`.

Use `artifact_get` to inspect produced artifacts and `artifact_download_link` when another service or the user needs a short-lived HTTPS download URL.

When PWA Preview is available and the built output is a static web application, use:

1. `project_build`
2. `artifact_download_link`
3. PWA Preview `preview_create` for a new preview or `preview_update` for an existing preview

Agent Workspace and PWA Preview remain independent services. Do not assume PWA Preview is installed.

For screenshots of a published preview, use Browser Screenshot with the preview URL when that service is available.

## Cleanup

Destroy the logical workspace with `workspace_destroy` when the workflow is complete unless the user explicitly needs the workspace to remain available for continued work.

Treat cleanup as part of the workflow, especially after failures: do not leave execution resources running unnecessarily.
