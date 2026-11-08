# Dedicated Rust runtime, later reused as the Tauri base.
# Avoid old Debian CVEs inherited by the official Rust compiler image.
FROM ubuntu:24.04

ARG RUST_VERSION=1.99.1
ENV DEBIAN_FRONTEND=noninteractive
ENV CARGO_HOME=/home/agent-workspace/.cargo
ENV RUSTUP_HOME=/home/agent-workspace/.rustup
ENV PATH=/home/agent-workspace/.cargo/bin:$PATH

## Bootstrap CA trust via signed Ubuntu apt indexes before forcing HTTPS.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates; \
    find /etc/apt -type f \( -name '*.list' -o -name '*.sources' \) -exec sed -i 's|http://|https://|g' {} +; \
    apt-get update; \
    apt-get upgrade -y; \
    apt-get install -y --no-install-recommends \
      ca-certificates curl git build-essential pkg-config libssl-dev \
      python3 python3-pip python3-venv jq zip unzip tar gzip; \
    rm -rf /var/lib/apt/lists/*; \
    groupadd --system agent-workspace; \
    useradd --system --gid agent-workspace --create-home --home-dir /home/agent-workspace agent-workspace; \
    mkdir -p /workspace; \
    chown -R agent-workspace:agent-workspace /workspace /home/agent-workspace

USER agent-workspace
RUN set -eux; \
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --profile minimal --default-toolchain ${RUST_VERSION} --component rustfmt --component clippy; \
    rustc --version; \
    cargo --version; \
    cargo fmt --version; \
    cargo clippy --version; \
    rustup --version

WORKDIR /workspace
CMD ["sleep", "3600"]
