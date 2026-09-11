# syntax=docker/dockerfile:1

# Web service. Built by Coolify from this file; see DEPLOY.md in the planning repo.
#
# Three stages so the final image carries no package manager, no lockfile and no
# dev dependencies — only the standalone server Next traced for us.

ARG NODE_VERSION=22-alpine


# ---- deps ---------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml ./
# --ignore-scripts: nothing here needs a postinstall to build the app, and it
# stops husky's `prepare` from failing in an image that has no .git directory.
RUN pnpm install --frozen-lockfile --ignore-scripts


# ---- builder ------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable pnpm

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# No environment needed to build: src/instrumentation.ts skips validation during
# phase-production-build, and nothing else reads env at module scope. Secrets are
# supplied at run time by Coolify, never baked into a layer.
RUN pnpm build


# ---- runner -------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# The standalone server binds localhost unless told otherwise, which makes the
# container reachable from nothing. This is the usual cause of a healthy-looking
# container behind a 502.
ENV HOSTNAME=0.0.0.0

# `node` (uid 1000) already exists in the base image — no useradd needed.
USER node

# server.js and the traced production node_modules; then the two things tracing
# does not cover.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

EXPOSE 3000

# TODO(commit 11): repoint at /api/health once it reports Mongo, Redis, MinIO and
# queue depth. Until then this only proves the server is answering.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
