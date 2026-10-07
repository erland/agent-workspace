# Artifact handoff to PWA Preview

Agent Workspace publishes build outputs as temporary artifacts. PWA Preview can consume a published static artifact through a short-lived signed HTTPS URL.

## Supported handoff

The canonical workflow is:

```text
project_build
  -> artifact id
  -> artifact_download_link
  -> signed HTTPS URL
  -> PWA Preview preview_create(sourceUrl)
```

For a static web application, prefer an explicit directory output when the build location is known:

```json
{
  "workspaceId": "ws_...",
  "outputs": [
    {
      "path": "dist",
      "name": "frontend",
      "kind": "static-web"
    }
  ]
}
```

Agent Workspace packages the directory as a `.tar.gz` artifact. PWA Preview accepts HTTPS URLs pointing to ZIP or tar.gz static artifacts, so the returned signed URL can be passed directly as `sourceUrl`.

## artifact_download_link response

The tool returns:

```json
{
  "result": {
    "artifactId": "art_...",
    "filename": "frontend.tar.gz",
    "mediaType": "application/gzip",
    "sizeBytes": 12345,
    "url": "https://agent-workspace.example/artifacts/download/...",
    "expiresAt": "2026-10-07T14:30:00.000Z"
  }
}
```

The link:

- is scoped to one artifact and its owning user,
- is cryptographically signed,
- requires no MCP authentication when fetched,
- expires after a short TTL and never outlives the artifact itself,
- should be consumed immediately rather than persisted as a long-lived deployment credential.

## Compatibility requirements for PWA Preview

PWA Preview `preview_create` expects an HTTPS `sourceUrl` that resolves to a ZIP or tar.gz archive.

For the default Agent Workspace directory-output flow:

- output path: directory such as `dist`
- artifact filename: `<name>.tar.gz`
- media type: `application/gzip`
- handoff: supported

If an explicit output is already a ZIP or tar.gz file, Agent Workspace publishes that file unchanged and it can also be handed off directly.

Other artifact types such as JAR, WAR, PDF, or generic binaries are valid Agent Workspace artifacts but are not valid PWA Preview inputs.

## Failure handling

If `preview_create` cannot fetch a signed artifact URL:

1. request a fresh `artifact_download_link` for the same artifact,
2. retry `preview_create` with the new URL,
3. do not rebuild the project unless the artifact itself is missing or expired.

If the artifact has expired, rerun `project_build` and create a new handoff URL.

## Migration significance

Once this handoff is covered by CI and deployment-level acceptance, Agent Workspace no longer needs to keep an interactive prototype sandbox alive for static web previews. That is the prerequisite for removing `prototype_start`, `prototype_preview_link`, and the screenshot-specific prototype tools.
