ARG JAVA_VERSION=21
FROM eclipse-temurin:${JAVA_VERSION}-jdk-noble

ARG NODE_MAJOR=22
ARG PLAYWRIGHT_VERSION=1.55.0

ENV DEBIAN_FRONTEND=noninteractive

RUN set -eux; \
    find /etc/apt -type f \( -name '*.list' -o -name '*.sources' \) -exec sed -i 's|http://|https://|g' {} +; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg maven unzip; \
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -; \
    apt-get install -y --no-install-recommends nodejs; \
    mkdir -p /opt/agent-workspace/browser-tools; \
    npm install --prefix /opt/agent-workspace/browser-tools "playwright@${PLAYWRIGHT_VERSION}"; \
    /opt/agent-workspace/browser-tools/node_modules/.bin/playwright install --with-deps chromium; \
    java -version; \
    node --version; \
    npm --version; \
    mvn --version; \
    /opt/agent-workspace/browser-tools/node_modules/.bin/playwright --version; \
    rm -rf /var/lib/apt/lists/* /root/.npm/_cacache

WORKDIR /workspace
CMD ["sleep", "3600"]
