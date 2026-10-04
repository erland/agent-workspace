# OpenAI plugin distribution

Agent Workspace ships a portable Agent Plugins 1.0 package for ChatGPT/Codex clients that connect to the existing remote MCP server.

The package contains:

```text
agent-workspace/
├── plugin.json
├── mcp.json
└── skills/
    └── agent-workspace/
        └── SKILL.md
```

The plugin does not contain or deploy the Agent Workspace service. It declares the existing Streamable HTTP MCP endpoint and adds workflow guidance for project upload, verification, builds, prototypes, screenshots, cleanup, and handoff of build artifacts to services such as PWA Preview.

## Source files

The repository keeps templates under `plugin/`:

- `plugin/plugin.template.json` — portable plugin manifest.
- `plugin/mcp.template.json` — remote MCP declaration.
- `plugin/skills/agent-workspace/SKILL.md` — workflow guidance.

Generated package files are written below `build/plugin/agent-workspace/` and are not committed.

## Build locally

Use a semantic version and optionally override the MCP endpoint:

```bash
AGENT_WORKSPACE_MCP_URL=https://agent-workspace.apphome.one/mcp \
  npm run plugin:build -- --version 1.0.0
```

If `AGENT_WORKSPACE_MCP_URL` is omitted, the build defaults to:

```text
https://agent-workspace.apphome.one/mcp
```

The build validates:

- strict semantic versioning;
- HTTPS for the MCP endpoint;
- generated JSON syntax;
- plugin identity and version;
- OpenAI short-description length;
- that the generated MCP URL matches the configured value.

## GitHub Actions

CI builds a test package with a non-production example MCP endpoint and verifies the generated manifest, MCP configuration, and skill.

When a GitHub Release is published, the release workflow:

1. derives the plugin version from the release tag, stripping a leading `v`;
2. builds the portable plugin package;
3. packages the top-level `agent-workspace/` directory as `agent-workspace-plugin-<version>.zip`;
4. inspects the archive and parses both generated JSON files;
5. uploads the ZIP as an asset on the same GitHub Release.

The existing application image release remains unchanged and is published in parallel.

## Configuration

The release workflow reads the repository or environment variable:

| Variable | Purpose | Default |
| --- | --- | --- |
| `AGENT_WORKSPACE_MCP_URL` | Remote Streamable HTTP MCP endpoint written to `mcp.json` | `https://agent-workspace.apphome.one/mcp` |

This value is public by design because it is embedded in the distributable plugin ZIP. Use a GitHub Actions variable rather than a secret.

OAuth credentials, Modal credentials, signing keys, session secrets, database URLs, bearer tokens, and all other private configuration must never be embedded in the plugin package.

## Why there is no .app.json

A ChatGPT-created plugin export may contain `.app.json` with an account/workspace-specific App binding. The portable package intentionally does not use that file. It connects through the documented remote MCP endpoint in `mcp.json`, so the same release artifact can be installed independently of the account that built it.

## Skill behavior

The included skill teaches the host to:

- establish a logical workspace and choose the appropriate ZIP transport;
- verify before building when verification is relevant;
- build artifacts only when needed;
- start prototypes only for runtime/visual checks;
- default ordinary UI verification to one desktop screenshot rather than three automatic form factors;
- use the screenshot gallery for visible presentation;
- create interactive preview links only when the user asks to try the prototype;
- use `workspace_destroy` as normal cleanup;
- hand off static build artifacts to PWA Preview when that independent plugin/service is available.
