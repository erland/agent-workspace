# OpenAI plugin distribution

Agent Workspace publishes one complete portable Agent Plugins package that is also the author-supplied ZIP for Marketplace/public submission.

## Package layout

`agent-workspace-plugin-<version>.zip` contains one self-contained plugin directory:

```text
agent-workspace/
├── plugin.json
├── mcp.json
├── assets/
│   ├── logo.png
│   └── composer-icon.png
└── skills/
    └── agent-workspace/
        └── SKILL.md
```

The public upload deliberately contains no `.app.json`, no non-null `apps` declaration and no `.codex-plugin/` update overlay. The Developer Portal can create the ChatGPT App binding from the remote MCP configuration during submission.

## MCP integration

`mcp.json` points at:

```text
https://agent-workspace.apphome.one/mcp
```

The remote server uses Agent Workspace OAuth. Each user authenticates independently and configures their own execution-provider credentials through Agent Workspace.

## Marketplace metadata

`plugin.json` includes:
- listing name, descriptions, category and default prompts;
- website: `https://agent-workspace.apphome.one/about`;
- support: `https://agent-workspace.apphome.one/support`;
- privacy policy: `https://agent-workspace.apphome.one/privacy`;
- terms: `https://agent-workspace.apphome.one/terms`;
- Marketplace logo and composer icon;
- five positive and three negative review cases;
- `commerce: false`;
- country targeting limited to Sweden (`SE`).

The public information pages are served without authentication.

## Build

```bash
AGENT_WORKSPACE_MCP_URL=https://agent-workspace.apphome.one/mcp \
  npm run plugin:build -- --version 1.0.0 --target marketplace
```

The generated source package is written under:

```text
build/plugin-marketplace/agent-workspace/
```

A `desktop` target remains available for portable direct-MCP use and produces the same complete structure.

## Release

A published GitHub Release builds:
- the application container image;
- `agent-workspace-plugin-<version>.zip` — the complete Marketplace/portable plugin ZIP.

No OAuth credential, Modal token, signing key, session secret, database credential or other secret may be embedded in the package.

## Public submission

The ZIP is the author-supplied source package. Portal-only submission work remains separate, including verified publisher identity, MCP/App conversion, reviewer credentials for the OAuth-protected workflow, demo recording, final attestations, testing of the saved app version and submission for review.
