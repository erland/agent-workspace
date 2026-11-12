# Minimal dedicated Go runtime. Rebuild and scan in CI before GHCR publication.
FROM golang:1.27.4-bookworm

ENV GOTOOLCHAIN=local \
    CGO_ENABLED=0 \
    GOPATH=/home/agent-workspace/go \
    GOCACHE=/home/agent-workspace/.cache/go-build
RUN set -eux; \
    groupadd --system agent-workspace; \
    useradd --system --gid agent-workspace --create-home agent-workspace; \
    mkdir -p /workspace /home/agent-workspace/go /home/agent-workspace/.cache/go-build; \
    chown -R agent-workspace:agent-workspace /workspace /home/agent-workspace
USER agent-workspace
WORKDIR /workspace
CMD ["sleep", "3600"]
