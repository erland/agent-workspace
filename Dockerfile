# syntax=docker/dockerfile:1.7
FROM node:22.23.3-alpine3.24 AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22.23.3-alpine3.24 AS runtime
ARG AGENT_WORKSPACE_VERSION=dev
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    AGENT_WORKSPACE_VERSION=${AGENT_WORKSPACE_VERSION}
WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY db ./db

# The production process only needs the Node runtime. Remove package-manager
# toolchains inherited from the base image to reduce unused attack surface.
USER root
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
             /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["sh", "-c", "node dist/persistence/postgres/migrate.js && exec node dist/mcp/remote.js"]
