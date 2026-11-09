# Tauri v2 Linux runtime, isolated from Rust/Java/Node profiles.
# The Rust toolchain is copied from the published, pinned rust-v1 image.
# Debian 13 supplies a newer WebKitGTK than Ubuntu 24.04.
ARG RUST_BASE_IMAGE=ghcr.io/erland/agent-workspace-runtime:rust-v1
FROM ${RUST_BASE_IMAGE} AS rust-toolchain
FROM node:22.21.1-bookworm-slim AS node-toolchain
FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV CARGO_HOME=/home/agent-workspace/.cargo
ENV RUSTUP_HOME=/home/agent-workspace/.rustup
ENV PATH=/home/agent-workspace/.cargo/bin:${PATH}

# Install signed distribution packages. The build tools and WebKitGTK v2
# prerequisites are preinstalled so uploaded projects cannot modify the base.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates; \
    find /etc/apt -type f \( -name '*.list' -o -name '*.sources' \) -exec sed -i 's|http://|https://|g' {} +; \
    apt-get update; \
    apt-get upgrade -y; \
    apt-get install -y --no-install-recommends \
      curl git build-essential pkg-config libssl-dev \
      python3 python3-pip python3-venv jq zip unzip tar gzip \
      libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
      librsvg2-dev libxdo-dev libgtk-3-dev patchelf file wget; \
    rm -rf /var/lib/apt/lists/*; \
    groupadd --system agent-workspace; \
    useradd --system --gid agent-workspace --create-home --home-dir /home/agent-workspace agent-workspace; \
    mkdir -p /workspace; \
    chown -R agent-workspace:agent-workspace /workspace /home/agent-workspace

# Both compiler and compiler-installed components are inherited from rust-v1,
# without mixing Ubuntu and Debian system libraries or using Rustup at runtime.
COPY --from=rust-toolchain --chown=agent-workspace:agent-workspace /home/agent-workspace/.cargo /home/agent-workspace/.cargo
COPY --from=rust-toolchain --chown=agent-workspace:agent-workspace /home/agent-workspace/.rustup /home/agent-workspace/.rustup

# Copy a pinned Node.js binary and npm distribution, then update npm's
# transitive dependencies to the previously validated patched npm version.
COPY --from=node-toolchain /usr/local/bin/node /usr/local/bin/node
COPY --from=node-toolchain /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN set -eux; \
    ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm; \
    ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx; \
    npm install --global npm@11.21.2 --no-audit --no-fund; \
    node --version; npm --version; \
    rustc --version; cargo --version; \
    pkg-config --modversion webkit2gtk-4.1; \
    pkg-config --modversion ayatana-appindicator3-0.1; \
    pkg-config --modversion librsvg-2.0; \
    test -f /usr/include/xdo.h

USER agent-workspace
WORKDIR /workspace
CMD ["sleep", "3600"]
