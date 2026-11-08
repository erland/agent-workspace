# PY-005 — Live acceptance of Python workflows in Modal

Date: **2026-11-08**. Environment: deployed Agent Workspace, connected per-user Modal account, default **java21-node22** runtime profile (runtime v9 Python functionality exercised; exact OCI image digest was not inspected).

## Scope

End-to-end acceptance of PY-001 through PY-004, selected npm/Maven regression, artifact handoff metadata, cleanup and ZIP input protection. Executed against the **deployed MCP tools**, not simulated providers. The test projects were temporary, created solely for acceptance; no customer repositories or credentials were used.

## Results

| Scenario | Evidence | Outcome |
| --- | --- | --- |
| Python project discovery | `pyproject.toml` recognized as `PYTHON` | PASS |
| PEP 517 wheel + sdist build | Python project `aw-py005-smoke` v0.1.0; `project_build` returned `PASSED` | PASS |
| Wheel publication | `aw_py005_smoke-0.1.0-py3-none-any.whl`, `application/zip`, 1,256 bytes, SHA-256 `cd99aec69239bf79a8f9fcd908fc0ed6570bd5f8d68e09057f405de08810191f` | PASS |
| Sdist publication | `aw_py005_smoke-0.1.0.tar.gz`, `application/gzip`, 1,095 bytes, SHA-256 `88745b1485b749f8c04fcf43ec11614c1062ebedf900d1a002ae72e4ccc03f90` | PASS |
| Artifact byte read | `file_read` with Base64 returned wheel's ZIP signature `PK\x03\x04` and sdist's gzip signature; sdist entry `aw_py005_smoke-0.1.0/smoke_pkg/__init__.py` contained the expected source text | PASS |
| Signed URL generation | Both artifacts received short-lived signed `https://agent-workspace.apphome.one/...` links with expected filename, MIME type and byte count | PASS |
| Python project tests | Same project, `project_verify` returned `PASSED` after venv, installation and unittest discovery (one test) | PASS |
| npm regression | Node `--test` fixture, `project_verify` returned `PASSED` (install + test) | PASS |
| Maven regression | Minimal Maven POM, `project_verify` returned `PASSED` | PASS |
| npm + Python mixed verification | One ZIP root containing `package.json`, `requirements.txt`, npm test and Python unittest; aggregate `PASSED`, two independent `PASSED` subresults | PASS |
| Non-package Python source | Requirements-only project, `project_build` returned `FAILED` with `Python build requires pyproject.toml`; no build artifacts | PASS |
| ZIP traversal protection | ZIP entry `../outside.txt` rejected with `INVALID_ARCHIVE` / `Illegal ZIP entry path` before execution | PASS |
| Sandbox termination and workspace cleanup | Every completed build/verify returned `terminationConfirmed: true`; all temporary logical workspaces were destroyed | PASS |

## Limitations and follow-ups

- **Not executed:** an independent HTTP GET of a signed artifact URL. URL creation and reading stored artifact bytes through MCP are verified separately, but transport via an external HTTPS consumer remains to be tested.
- **Not inspected:** underlying OCI digest or `v9` tag. Working Python venv, pip and PEP 517 packaging in the deployed Modal environment strongly demonstrate that the required runtime functionality is active, but do not establish the exact image digest.
- **Not exhaustive:** native-extension builds, alternate Python versions, all supported Java/Node runtime combinations, dependency-resolution failure matrices and all network boundary cases.
- **Observed limitation:** `file_read` with an inner path on a `.whl` returned `Requested artifact is not ZIP or tar.gz`; raw binary wheel reads did work. A wheel uses ZIP format, so extending inner-entry reading to `.whl` is a possible usability improvement, not a blocker for Python package build/publication.
- **Existing broader release gates:** this acceptance does not supersede external production gates tracked independently in `.system-builder/work-status.yaml` (such as OAuth/deployment verification).

## Conclusion

**PY-005 tested scope: PASS with documented limitations.** Python package build/publication and test verification work in deployed Modal; basic npm/Maven compatibility, mixed verification, ZIP validation and cleanup were exercised. An external signed-URL HTTP download remains an explicit follow-up before claiming the entire artifact handoff route is verified.
