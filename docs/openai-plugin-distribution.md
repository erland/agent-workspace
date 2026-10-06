# OpenAI plugin distribution

Agent Workspace ships two release package targets: a ChatGPT update package for the already registered ChatGPT app, and a portable direct-MCP package for desktop/other compatible clients.

## ChatGPT update package

The primary GitHub release artifact is intended to be uploaded as a new version of the existing ChatGPT app. It matches the structure exported by ChatGPT and has no extra top-level directory:

```text
.app.json
.codex-plugin/
└── plugin.json
```

The package preserves two stable identities:

- the registered ChatGPT App ID from `AGENT_WORKSPACE_CHATGPT_APP_ID`, for example `asdk_app_...`;
- the plugin name used by the ChatGPT export, normally `dev-<app-id-suffix>`.

By default the build derives the plugin name from the App ID. If the exported plugin uses a different stable name, set `AGENT_WORKSPACE_CHATGPT_PLUGIN_NAME` to that exact `dev-...` value.

For the current registered Agent Workspace app, the known identities are:

```text
App ID: asdk_app_6ac26be163c88191b081136c7222b2a6
Plugin name: dev-6ac26be163c88191b081136c7222b2a6
```

The ChatGPT UI creates its own `asdk_app_v_...` Version ID when a new app version is uploaded. That Version ID must not be embedded in the release ZIP.

Build locally with:

```bash
AGENT_WORKSPACE_CHATGPT_APP_ID=asdk_app_example \
  npm run plugin:build -- --version 1.5.1 --target chatgpt
```

Generated files are written directly under `build/plugin-chatgpt/`.

## Desktop / portable MCP package

The separate desktop package keeps the Agent Plugins 1.0 direct-MCP structure:

```text
agent-workspace/
├── plugin.json
├── mcp.json
└── skills/
    └── agent-workspace/
        └── SKILL.md
```

It declares the existing Streamable HTTP MCP endpoint and includes workflow guidance for project upload, verification, builds, prototypes, screenshots, cleanup, and handoff of build artifacts to services such as PWA Preview.

Build locally with:

```bash
AGENT_WORKSPACE_MCP_URL=https://agent-workspace.apphome.one/mcp \
  npm run plugin:build -- --version 1.5.1 --target desktop
```

The generated package is written under `build/plugin-desktop/agent-workspace/`.

## Source files

The repository keeps templates under `plugin/`:

- `plugin/chatgpt-update.template.json` — ChatGPT update manifest.
- `plugin/app.template.json` — ChatGPT app binding.
- `plugin/plugin.template.json` — portable Agent Plugins manifest.
- `plugin/mcp.template.json` — remote MCP declaration.
- `plugin/skills/agent-workspace/SKILL.md` — workflow guidance.

## GitHub Actions

CI builds and validates both package targets.

When a GitHub Release is published, the release workflow:

1. derives the plugin version from the release tag, stripping a leading `v`;
2. requires `AGENT_WORKSPACE_CHATGPT_APP_ID`;
3. builds the ChatGPT update package and the desktop MCP package;
4. creates `agent-workspace-plugin-<version>.zip` with `.app.json` and `.codex-plugin/` directly at the ZIP root;
5. creates `agent-workspace-plugin-desktop-<version>.zip` with the portable `agent-workspace/` top-level directory;
6. inspects both archives before attaching them to the GitHub Release.

The application image release remains unchanged and is published in parallel.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `AGENT_WORKSPACE_CHATGPT_APP_ID` | Stable registered ChatGPT App ID used by the update ZIP | none; required for release |
| `AGENT_WORKSPACE_CHATGPT_PLUGIN_NAME` | Stable exported `dev-...` plugin name | derived from App ID |
| `AGENT_WORKSPACE_MCP_URL` | Remote Streamable HTTP MCP endpoint written to the desktop package | `https://agent-workspace.apphome.one/mcp` |

These values are public identifiers/configuration embedded in release artifacts, so use GitHub Actions variables rather than secrets.

OAuth credentials, Modal credentials, signing keys, session secrets, database URLs, bearer tokens, and all other private configuration must never be embedded in either plugin package.

## Updating the ChatGPT app

After the app has been registered once:

1. keep `AGENT_WORKSPACE_CHATGPT_APP_ID` stable;
2. publish a new GitHub Release;
3. download `agent-workspace-plugin-<version>.zip`;
4. upload that ZIP as a new version of the existing ChatGPT app.

The portable desktop ZIP is not the update artifact for the registered ChatGPT app.

## Skill behavior

The portable package skill teaches the host to:

- establish a logical workspace and choose the appropriate ZIP transport;
- verify before building when verification is relevant;
- build artifacts only when needed;
- start prototypes only for runtime/visual checks;
- default ordinary UI verification to one desktop screenshot rather than three automatic form factors;
- use the screenshot gallery for visible presentation;
- create interactive preview links only when the user asks to try the prototype;
- use `workspace_destroy` as normal cleanup;
- hand off static build artifacts to PWA Preview when that independent plugin/service is available.
