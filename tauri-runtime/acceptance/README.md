# Tauri Linux build acceptance fixture

This is a deliberately minimal, **non-executed** Tauri v2 desktop app. GitHub Actions runs the Node frontend build, Cargo unit tests, Cargo compilation, and Tauri CLI's `build --no-bundle` in the published Tauri runtime image.

No GUI, WebKit WebView, X11, Wayland, browser automation or application process is launched. The fixture intentionally does not exercise WebKitGTK at runtime, in line with the temporary CVE-2026-3909 risk acceptance. Windows/macOS builds and .deb/AppImage packaging are excluded.

The published image must be pulled from GHCR; this validation does not rebuild it from an editable Dockerfile. A failed pull means publication is not verified and stops the acceptance.
