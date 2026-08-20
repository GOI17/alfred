# syntax=docker/dockerfile:1.7
# Alfred Memory v0.4.1 production image.
#
# Alfred Memory uses Node.js built-ins for its local-first path and the `pg`
# driver when SaaS tenant bootstrap is enabled with ALFRED_SAAS_DATABASE_URL.

ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION}

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV ALFRED_MEMORY_PORT=8080
ENV ALFRED_MEMORY_BIND=0.0.0.0
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
  && pnpm install --prod --frozen-lockfile --filter @alfred-labs/memory-server
# The openapi-router reads two registry files at runtime for /agents/manifest
# and /skills/manifest. They live under .ai/ which is otherwise excluded.
COPY --chown=alfred:alfred .ai/agents/registry.json ./.ai/agents/registry.json
COPY --chown=alfred:alfred .ai/skills/registry.json ./.ai/skills/registry.json

USER alfred

EXPOSE 8080

# The entrypoint runs migrations then starts the server.
CMD ["/bin/sh", "-c", "node packages/memory-server/scripts/migrate-on-boot.mjs && node packages/memory-server/scripts/alfred.mjs serve --port $PORT --bind 0.0.0.0"]
