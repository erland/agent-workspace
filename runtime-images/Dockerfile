ARG JAVA_VERSION=21
FROM eclipse-temurin:${JAVA_VERSION}-jdk-noble

ARG NODE_MAJOR=22
ARG PLAYWRIGHT_VERSION=1.55.1
ARG NPM_VERSION=11.21.0

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/opt/agent-workspace/ms-playwright

RUN set -eux; \
    find /etc/apt -type f \( -name '*.list' -o -name '*.sources' \) -exec sed -i 's|http://|https://|g' {} +; \
    apt-get update; \
    apt-get upgrade -y; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg maven unzip; \
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -; \
    apt-get install -y --no-install-recommends nodejs; \
    npm install -g "npm@${NPM_VERSION}"; \
    npm_root="$(npm root -g)/npm"; \
    mkdir -p /tmp/npm-security-patches/brace /tmp/npm-security-patches/undici; \
    cd /tmp/npm-security-patches; \
    npm pack "brace-expansion@5.0.11"; \
    npm pack "undici@6.28.1"; \
    tar -xzf brace-expansion-5.0.11.tgz -C brace --strip-components=1; \
    tar -xzf undici-6.28.1.tgz -C undici --strip-components=1; \
    find "${npm_root}" -type f -path '*/brace-expansion/package.json' -printf '%h\n' \
      | while read -r dir; do rm -rf "${dir}"; cp -a /tmp/npm-security-patches/brace "${dir}"; done; \
    find "${npm_root}" -type f -path '*/undici/package.json' -printf '%h\n' \
      | while read -r dir; do rm -rf "${dir}"; cp -a /tmp/npm-security-patches/undici "${dir}"; done; \
    ! grep -R --include=package.json -l '"version": "5.0.9"' "${npm_root}"/node_modules/brace-expansion 2>/dev/null; \
    ! grep -R --include=package.json -l '"version": "6.28.0"' "${npm_root}"/node_modules/undici 2>/dev/null; \
    rm -rf /tmp/npm-security-patches; \
    cd /; \
    mkdir -p /opt/agent-workspace/browser-tools; \
    npm install --prefix /opt/agent-workspace/browser-tools "playwright@${PLAYWRIGHT_VERSION}"; \
    /opt/agent-workspace/browser-tools/node_modules/.bin/playwright install --with-deps chromium; \
    java -version; \
    node --version; \
    npm --version; \
    mvn --version; \
    /opt/agent-workspace/browser-tools/node_modules/.bin/playwright --version; \
    rm -rf /var/lib/apt/lists/* /root/.npm/_cacache; \
    groupadd --system agent-workspace; \
    useradd --system --gid agent-workspace --create-home --home-dir /home/agent-workspace agent-workspace; \
    mkdir -p /workspace; \
    chown -R agent-workspace:agent-workspace /workspace

WORKDIR /workspace
USER agent-workspace
CMD ["sleep", "3600"]
