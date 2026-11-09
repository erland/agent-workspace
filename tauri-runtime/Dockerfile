# Tauri v2 Linux *build-only* image: no GUI/browser runtime validation.
# Build on the validated Rust Ubuntu 24.04 base; release CVE exceptions
# are strictly bounded by tauri-runtime/trivy-temporary-policy.rego.
ARG RUST_BASE_IMAGE=ghcr.io/erland/agent-workspace-runtime:rust-v1
FROM node:22.21.1-bookworm-slim AS node-toolchain
FROM ${RUST_BASE_IMAGE}

USER root
ENV DEBIAN_FRONTEND=noninteractive
RUN set -eux; \
    apt-get update; \
    apt-get upgrade -y; \
    apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
      librsvg2-dev libxdo-dev libssl-dev \
      libgtk-3-dev patchelf file; \
    rm -rf /var/lib/apt/lists/*

COPY --from=node-toolchain /usr/local/bin/node /usr/local/bin/node
COPY --from=node-toolchain /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN set -eux; \
    ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm; \
    ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx; \
    npm install --global npm@11.21.2 --no-audit --no-fund; \
    node --version; npm --version; rustc --version; cargo --version; \
    pkg-config --modversion webkit2gtk-4.1; \
    pkg-config --modversion ayatana-appindicator3-0.1; \
    pkg-config --modversion librsvg-2.0; \
    test -f /usr/include/xdo.h

# Defense in depth. This image has no Xvfb, display server, or desktop session.
# Prevent accidental GUI startup in stock tool workflows. Untrusted arbitrary
# build scripts may still attempt to launch GUI tools; sandbox isolation remains required.
ENV DISPLAY="" WAYLAND_DISPLAY="" GDK_BACKEND="none"
USER agent-workspace
WORKDIR /workspace
CMD ["sleep", "3600"]
