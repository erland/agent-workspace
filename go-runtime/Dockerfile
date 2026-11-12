# Minimal dedicated Go runtime. Build and scan in CI before GHCR publication.
# Alpine reduces the OS attack surface compared with a full Debian build image.
FROM golang:1.27.4-alpine3.23

RUN apk add --no-cache bash git ca-certificates \
    && addgroup -S agent-workspace \
    && adduser -S -G agent-workspace agent-workspace \
    && mkdir -p /workspace /home/agent-workspace/go /home/agent-workspace/.cache/go-build \
    && chown -R agent-workspace:agent-workspace /workspace /home/agent-workspace

ENV GOTOOLCHAIN=local \
    CGO_ENABLED=0 \
    GOPATH=/home/agent-workspace/go \
    GOCACHE=/home/agent-workspace/.cache/go-build

USER agent-workspace
WORKDIR /workspace
CMD ["sleep", "3600"]
