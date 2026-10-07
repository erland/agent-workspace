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

The following current Agent Workspace MCP tools are transitional and will be removed after the artifact handoff is verified:

- `prototype_start`
- `prototype_preview_link`
- `prototype_screenshot`
- `prototype_screenshot_gallery`
- `prototype_stop`

Related prototype hosting, screenshot resources, screenshot gallery UI, Playwright/Chromium-specific code, tests, dependencies, and documentation should then be removed.

## Runtime boundary

Agent Workspace runtime images only need tooling required to verify and build supported projects. Browser runtime dependencies are not part of the target Agent Workspace architecture.

After the prototype/screenshot migration is complete, Playwright and Chromium should be removed from Agent Workspace runtime images unless another retained build/verification capability explicitly requires them.

## Migration rule

This document describes the target state. Existing prototype tools remain available until the artifact contract and Agent Workspace -> PWA Preview handoff have been strengthened and verified.

The migration order is therefore:

1. establish service boundaries,
2. strengthen `project_build` output/artifact behavior,
3. verify signed artifact handoff to PWA Preview,
4. retire Agent Workspace preview tools,
5. retire Agent Workspace screenshot tools and browser runtime,
6. remove obsolete implementation, tests, dependencies, storage, and documentation.
