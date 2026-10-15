# syntax=docker/dockerfile:1
#
# The Bun services: API, realtime gateway, worker, and the development mail
# sink. One file, one named stage per service (`--target api`), because they
# share a runtime, a dependency install and most of their source; each stage
# sets its own port, health check and command.
#
# Build from the repository root:
#   docker build -f deploy/docker/backend.Dockerfile --target api -t robis-api .

# Pinned by digest as well as version, so a rebuilt image starts from the
# same bytes. Bun 1.4.2 is the version CI and development use.
ARG BUN_IMAGE=oven/bun:1.4.2-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61

# ---------------------------------------------------------------------------
# The pinned image plus Debian's security updates since it was published, so
# a fix that exists is in the image even before the base is re-pinned. The
# image scan in CI fails on any critical finding that has a fix.
FROM ${BUN_IMAGE} AS base
RUN apt-get update \
  && apt-get -y upgrade --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Dependencies: production only, for the backend workspaces.
FROM base AS deps
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY backend ./backend
COPY shared ./shared
COPY frontend/package.json ./frontend/package.json
COPY scripts ./scripts
# Frozen: the image gets exactly what bun.lock records, which already lists
# the Linux variants of the native packages (argon2, sharp).
RUN bun install --frozen-lockfile --production --filter '@robis/api' --filter '@robis/worker' --filter '@robis/realtime'

# ---------------------------------------------------------------------------
# What every backend image runs: source plus its installed dependencies.
# No build step: Bun runs the TypeScript directly, as it does in development.
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/tsconfig.base.json ./
COPY --from=deps /app/backend ./backend
COPY --from=deps /app/shared ./shared
# The image's own unprivileged user; nothing here needs root.
USER bun

# ---------------------------------------------------------------------------
FROM runtime AS api
ENV API_HOST=0.0.0.0 API_PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:4000/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "backend/api/src/main.ts"]

# ---------------------------------------------------------------------------
FROM runtime AS realtime
ENV REALTIME_PORT=4001
EXPOSE 4001
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:4001/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "backend/realtime/src/main.ts"]

# ---------------------------------------------------------------------------
FROM runtime AS worker
# No port: healthy means the loop touched its heartbeat file recently.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD ["bun", "backend/worker/src/health.ts"]
CMD ["bun", "backend/worker/src/main.ts"]

# ---------------------------------------------------------------------------
# Development and CI only: catches mail so a test can read it. Never deploy.
FROM base AS mail-sink
WORKDIR /sink
# Exact version, recorded in THIRD_PARTY_NOTICES.md. Its own install keeps
# the development dependencies out of this image.
RUN bun add smtp-server@3.19.15 --exact
COPY scripts/mail ./
ENV MAIL_SINK_HOST=0.0.0.0
EXPOSE 1025 8025
USER bun
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:8025/messages').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "sink.ts"]
