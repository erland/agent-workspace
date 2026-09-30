# DEV-010 verification

## Implemented

- Eight v1 MCP tools registered through the MCP TypeScript server SDK.
- Zod v4 input/output schemas.
- Provider-neutral tool-service layer.
- Standardized error envelope.
- `project_verify` dispatches to npm or Maven from uploaded-project analysis.
- `prototype_screenshot` returns MCP `image` content plus structured metadata.
- Development stdio transport for local MCP-client testing.

## ZIP input note

Standard MCP tool arguments are JSON. DEV-010 therefore uses `archiveBase64` for `workspace_upload_zip`. This keeps the MCP contract portable, but large-file ergonomics for ChatGPT/Claude must be validated before production release; a staged upload/resource mechanism may replace the transport without changing the workspace core.

## Verification

Run:

```bash
npm install
npm run verify:dev010
```

`verify:dev010` also launches the MCP server over stdio with the official MCP client, verifies all eight tool names, calls `get_capabilities`, creates a Java 21 + Node 22 Modal workspace, and destroys it.

A successful authenticated run is required before DEV-010 is marked fully verified.
