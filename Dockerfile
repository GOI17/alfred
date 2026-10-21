# syntax=docker/dockerfile:1.7
# Alfred Memory local process image; no public listener or published ports.
#
# Alfred Memory uses Node.js built-ins for its local-first path and the `pg`
# driver when SaaS tenant bootstrap is enabled with ALFRED_SAAS_DATABASE_URL.

ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION}

WORKDIR /app

ENV NODE_ENV=production
ENV ALFRED_MEMORY_PORT=3000
ENV ALFRED_MEMORY_BIND=127.0.0.1
ENV ALFRED_MEMORY_REGISTRY=/app/data/registry.sqlite

# Create a non-root user for runtime safety.
# Debian's SYS_UID_MAX is 999, so we use 1001 and silence the warning.
RUN groupadd --system --gid 1001 alfred \
  && useradd --system --uid 1001 --gid alfred --home /app --shell /usr/sbin/nologin alfred \
  && mkdir -p /app/data && chown -R alfred:alfred /app

# Copy the source. We copy package.json + lockfiles first to leverage Docker
# layer cache, even though we don't run an install step today.
COPY --chown=alfred:alfred package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY --chown=alfred:alfred packages ./packages
COPY --chown=alfred:alfred scripts ./scripts
RUN corepack enable \
  && pnpm install --prod --frozen-lockfile --filter @alfred-labs/memory-server...
# Fail the image build if the production dependency graph cannot load the real
# MCP server factory and register Alfred Memory's tools.
RUN node scripts/check-memory-mcp-production.mjs
# The openapi-router reads two registry files at runtime for /agents/manifest
# and /skills/manifest. They live under .ai/ which is otherwise excluded.
COPY --chown=alfred:alfred .ai/agents/registry.json ./.ai/agents/registry.json
COPY --chown=alfred:alfred .ai/skills/registry.json ./.ai/skills/registry.json

USER alfred

# The entrypoint runs migrations then starts the server.
CMD ["/bin/sh", "-c", "node packages/memory-server/scripts/migrate-on-boot.mjs && node packages/memory-server/scripts/alfred.mjs serve"]
