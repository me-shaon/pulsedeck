# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Production image for the PulseDeck API. Multi-stage:
#   1. build   — install the pnpm workspace, bundle src → dist with tsup, and
#                produce a pruned prod-only deployment via `pnpm deploy`.
#   2. runtime — slim, non-root image carrying only dist + production deps.
#
# The build context is the repo ROOT (see docker-compose.yml) so the whole pnpm
# workspace is available for install/resolution. tsup inlines @pulsedeck/schema
# (see tsup.config.ts), so the runtime needs no workspace package — only the
# bundle and its external npm dependencies. Migrations run on startup from
# src/index.ts (runMigrations), so the generated SQL ships in ./drizzle.
# ---------------------------------------------------------------------------

# ---- Build stage -----------------------------------------------------------
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

# Copy the entire workspace (lockfile, manifests, sources). .dockerignore keeps
# node_modules/dist/etc. out so the layer is lean and reproducible.
COPY . .

# Deterministic install of the full workspace (dev deps needed to build).
RUN pnpm install --frozen-lockfile

# Bundle the API to dist/index.js (ESM, node22). Schema source is inlined.
RUN pnpm --filter @pulsedeck/api build

# Carve out a self-contained, prod-only deployment: a flattened node_modules
# with workspace deps materialized and devDependencies stripped.
RUN pnpm --filter @pulsedeck/api deploy --prod /deploy

# ---- Runtime stage ---------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Production dependencies only (no dev deps, no tsup/tsx/drizzle-kit).
COPY --from=build --chown=node:node /deploy/node_modules ./node_modules
# The bundled server + the migration SQL applied on startup + the manifest.
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/apps/api/drizzle ./drizzle
COPY --from=build --chown=node:node /repo/apps/api/package.json ./package.json

# Drop privileges: the `node` user ships with the official image (uid 1000).
USER node
EXPOSE 3001

# Migrations run inside src/index.ts before the server listens; just start it.
CMD ["node", "dist/index.js"]
