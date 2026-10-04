---
name: agent-workspace
description: Use Agent Workspace when the user wants to inspect, verify, build, run, or test a source project in an isolated execution workspace.
---

# Agent Workspace workflow

Agent Workspace provides isolated execution for uploaded source projects. Use it for project inspection, dependency installation, verification, builds, temporary web prototypes, screenshots, and build artifacts.

Prefer the smallest workflow that satisfies the user's request. Do not start a prototype or take screenshots unless the user needs runtime or visual verification.

## Establish the workspace

When beginning a project workflow:

1. Use `get_profile` when user/account readiness matters.
2. Use `get_capabilities` when runtime support or available execution capabilities matter.
3. Create a logical workspace with `workspace_create`.
4. Upload the source archive with `workspace_upload_zip` when ChatGPT can supply an attached ZIP through file parameters.
5. Use `workspace_upload_zip_from_url` only when a public HTTPS source URL is the appropriate transport.

Do not treat source download URLs as Agent Workspace authorization. Authentication and user isolation remain enforced by the MCP connection.

## Verify and build

Use `project_verify` when the user wants to know whether the project compiles, tests, or otherwise passes its normal verification workflow.

Use `project_build` when the user needs built output or an artifact for later handoff.

Use `artifact_get` to inspect produced artifacts and `artifact_download_link` when another service or the user needs a short-lived HTTPS download URL.

When PWA Preview is available and the built output is a static web application, an appropriate handoff is:

1. `project_build`
2. `artifact_download_link`
3. PWA Preview `preview_create` for a new preview or `preview_update` for an existing preview

Agent Workspace and PWA Preview remain independent services. Do not assume PWA Preview is installed.

## Web prototypes

Use `prototype_start` only for a project that can run as a web prototype and only when runtime interaction or visual verification is useful.

Use `prototype_preview_link` only when the user wants to open or interact with the running prototype.

Use `prototype_stop` as soon as the interactive prototype is no longer needed.

## Screenshots

Use `prototype_screenshot` for a requested viewport or device profile.

For ordinary UI verification, default to one desktop screenshot. Do not automatically capture desktop, tablet, and mobile variants unless the user asks for multiple form factors or the task specifically requires responsive verification.

When one or more captures should be shown through the MCP App UI, use `prototype_screenshot_gallery` with the screenshot artifact IDs.

## Cleanup

Destroy the logical workspace with `workspace_destroy` when the workflow is complete unless the user explicitly needs the workspace to remain available for continued work.

If a prototype was started, stop it before destroying the workspace when practical.

Treat cleanup as part of the workflow, especially after failures: do not leave execution resources running unnecessarily.
