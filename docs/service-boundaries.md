# Target service boundaries

This document defines the target responsibility split between Agent Workspace, PWA Preview, and Browser Screenshot.

## Goal

Agent Workspace is narrowed to temporary execution, verification, build, and artifact publication. Static preview hosting and browser rendering are delegated to dedicated services.

```text
Project / ZIP
    |
    v
+----------------------+
| Agent Workspace      |
|                      |
| workspace lifecycle  |
| verification         |
| build                |
| artifact publication |
+----------+-----------+
           |
           | signed artifact URL
           v
+----------------------+
| PWA Preview          |
|                      |
| static deployment    |
| preview lifecycle    |
+----------+-----------+
           |
           | public preview URL
           v
+----------------------+
| Browser Screenshot   |
|                      |
| browser rendering    |
| viewport/device      |
| screenshot UI        |
+----------------------+
```

## MCP surface before and after migration

The current and target Agent Workspace MCP surfaces are:

| Capability | Current | Target | Owner after migration |
| --- | --- | --- | --- |
| `get_capabilities` | keep | keep | Agent Workspace |
| `get_profile` | keep | keep | Agent Workspace |
| `workspace_create` | keep | keep | Agent Workspace |
| `workspace_upload_zip` | keep | keep | Agent Workspace |
| `workspace_upload_zip_from_url` | keep | keep | Agent Workspace |
| `project_verify` | keep | keep | Agent Workspace |
| `project_build` | keep | keep and strengthen output selection | Agent Workspace |
| `artifact_get` | keep | keep | Agent Workspace |
| `artifact_download_link` | keep | keep as cross-service handoff | Agent Workspace |
| `prototype_start` | available | remove | PWA Preview replaces preview execution |
| `prototype_preview_link` | available | remove | PWA Preview returns preview URL |
| `prototype_screenshot` | available | remove | Browser Screenshot |
| `prototype_screenshot_gallery` | available | remove | Browser Screenshot presentation |
| `prototype_stop` | available | remove | PWA Preview lifecycle |
| `workspace_destroy` | keep | keep | Agent Workspace |

This reduces Agent Workspace from 15 public MCP tools to 10 target tools and removes the ambiguous overlap where an MCP client can currently choose Agent Workspace or the dedicated services for preview/screenshot work.

No tool is removed in the architecture/documentation steps. Removal happens only after the artifact contract and signed URL handoff are verified.

## Agent Workspace owns

The target public MCP surface is:

- `get_capabilities`
- `get_profile`
- `workspace_create`
- `workspace_upload_zip`
- `workspace_upload_zip_from_url`
- `project_verify`
- `project_build`
- `artifact_get`
- `artifact_download_link`
- `workspace_destroy`

Agent Workspace is responsible for:

1. creating temporary execution environments,
2. receiving source projects,
3. verifying projects,
4. building projects,
5. selecting one or more requested build outputs,
6. packaging outputs as artifacts,
7. exposing artifacts as MCP resources and/or short-lived HTTPS links,
8. cleaning up workspace resources.

The artifact contract is the integration boundary to downstream services.

## PWA Preview owns

PWA Preview is the only service responsible for static web preview publication and lifecycle management.

Its MCP responsibilities are:

- `preview_create`
- `preview_list`
- `preview_get`
- `preview_update`
- `preview_extend`
- `preview_delete`

The supported handoff is:

```text
Agent Workspace project_build
    -> artifact_download_link
    -> PWA Preview preview_create(sourceUrl)
```

The concrete contract and failure handling are documented in `docs/artifact-handoff.md`.

Agent Workspace must not retain a second static preview/public-hosting implementation.

## Browser Screenshot owns

Browser Screenshot is the only service responsible for browser rendering and screenshots.

Its public MCP responsibility is:

- `screenshot_create`

It owns:

- Chromium/Playwright runtime,
- navigation and SSRF policy,
- viewport and device profiles,
- PNG capture,
- screenshot presentation,
- fullscreen/download UI.

Agent Workspace must not retain a second browser/screenshot subsystem after the migration is complete.

## Capabilities to retire from Agent Workspace

The following former Agent Workspace MCP tools have been retired after the artifact handoff was established:

- `prototype_start`
- `prototype_preview_link`
- `prototype_screenshot`
- `prototype_screenshot_gallery`
- `prototype_stop`

Prototype hosting, screenshot MCP resources/UI, implementation code, and dedicated tests are removed from Agent Workspace. Runtime-image browser dependencies are cleaned up separately so that API removal and image changes can be verified independently.

## Runtime boundary

Agent Workspace runtime images only need tooling required to verify and build supported projects. Browser runtime dependencies are not part of the target Agent Workspace architecture.

After the prototype/screenshot migration is complete, Playwright and Chromium should be removed from Agent Workspace runtime images unless another retained build/verification capability explicitly requires them.

## Migration rule

The MCP/API migration to the target state is complete: Agent Workspace exposes build/artifact capabilities, while preview and screenshot responsibilities live in the dedicated services.

The remaining cleanup is:

1. verify the reduced MCP surface and artifact handoff in CI/deployed acceptance,
2. remove Playwright/Chromium from Agent Workspace runtime images,
3. remove or archive remaining historical prototype-specific development documentation where useful.
