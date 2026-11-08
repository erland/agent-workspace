# Tauri v2 Linux build environment. Inherits the same pinned Rust toolchain as rust-v1.
# Tauri dependencies are project-controlled; no global Tauri CLI is installed.
ARG RUST_BASE_IMAGE=ghcr.io/erland/agent-workspace-runtime:rust-v1
FROM node:22.21.1-bookworm-slim AS node-toolchain
FROM ${RUST_BASE_IMAGE}

USER root
ENV DEBIAN_FRONTEND=noninteractive
# Tauri v2 Linux prerequisites (WebKitGTK 4.1, AppIndicator, librsvg, Xdo)
# are installed from signed Ubuntu archives, never by executing a setup script.
RUN set -eux; \
    apt-get update; \
    apt-get upgrade -y; \
    apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
      librsvg2-dev libxdo-dev libssl-dev \
      libgtk-3-dev patchelf file wget; \
    rm -rf /var/lib/apt/lists/*

# Copy version-pinned Node/npm from the official Node Docker image.
# Rust/Cargo stay in the inherited Rust image and are not reinstalled.
COPY --from=node-toolchain /usr/local/bin/node /usr/local/bin/node
COPY --from=node-toolchain /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN set -eux; \
    ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm; \
    ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx; \
    node --version; npm --version; \
    pkg-config --modversion webkit2gtk-4.1; \
    pkg-config --modversion ayatana-appindicator3-0.1; \
    pkg-config --modversion librsvg-2.0; \
    test -f /usr/include/xdo.h

USER agent-workspace
WORKDIR /workspace
CMD ["sleep", "3600"]
