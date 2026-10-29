# syntax=docker/dockerfile:1
#
# The Next.js web app, as a standalone server: the build traces exactly the
# files the server imports, so the image carries no build tooling and no
# development dependencies.
#
# The API and gateway addresses are compiled into the client bundle, so they
# are build arguments, not runtime settings:
#   docker build -f deploy/docker/web.Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
#     --build-arg NEXT_PUBLIC_REALTIME_URL=wss://rt.example.com/ws -t robis-web .

ARG BUN_IMAGE=oven/bun:1.4.2-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61

# ---------------------------------------------------------------------------
FROM ${BUN_IMAGE} AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY frontend ./frontend
COPY shared ./shared
COPY backend ./backend
COPY scripts ./scripts
# Only its manifest: the lockfile lists every workspace, and nothing here runs the tests.
COPY tests/package.json ./tests/package.json
# Frozen: see backend.Dockerfile.
RUN bun install --frozen-lockfile --filter '@robis/web'

# Empty by default: the app reaches the API at /api and the gateway at /ws
# on its own origin, through the edge proxy, so one image runs anywhere.
# A production build refuses either one naming localhost (next.config.ts).
ARG NEXT_PUBLIC_API_URL=
ARG NEXT_PUBLIC_REALTIME_URL=
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_REALTIME_URL=${NEXT_PUBLIC_REALTIME_URL} \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
RUN bun --filter '@robis/web' build

# ---------------------------------------------------------------------------
# What ships: the pinned image plus Debian's security updates since it was
# published (see backend.Dockerfile), and the traced server.
FROM ${BUN_IMAGE} AS web
RUN apt-get update \
  && apt-get -y upgrade --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=bun:bun /app/frontend/.next/standalone ./
COPY --from=build --chown=bun:bun /app/frontend/.next/static ./frontend/.next/static
COPY --from=build --chown=bun:bun /app/frontend/public ./frontend/public
USER bun
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "frontend/server.js"]
