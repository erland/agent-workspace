# Rust-only toolchain image. Tauri will extend this image in LANG-003C.
# Pin the compiler version; image tag (rust-vN) is managed independently of Java/Node.
FROM rust:1.99.1-bookworm

ENV DEBIAN_FRONTEND=noninteractive
RUN set -eux; \
    apt-get update; \
    apt-get upgrade -y; \
    apt-get install -y --no-install-recommends \
      ca-certificates curl git build-essential pkg-config libssl-dev \
      python3 python3-pip python3-venv jq zip unzip tar gzip; \
    rustup component add rustfmt clippy; \
    rustc --version; cargo --version; rustup --version; \
    cargo fmt --version; cargo clippy --version; \
    rm -rf /var/lib/apt/lists/*; \
    groupadd --system agent-workspace; \
    useradd --system --gid agent-workspace --create-home --home-dir /home/agent-workspace agent-workspace; \
    mkdir -p /workspace; \
    chown -R agent-workspace:agent-workspace /workspace /usr/local/cargo /usr/local/rustup

WORKDIR /workspace
USER agent-workspace
CMD ["sleep", "3600"]
