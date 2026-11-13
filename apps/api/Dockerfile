# ArcDrop API — production image (plan D8: Bun everywhere, D11: migrate-on-boot).
# Build context is the repository ROOT (see compose.yaml) because the Bun
# workspace install needs the root package.json + bun.lock.

# --- build stage: install full deps and bundle ------------------------------
FROM oven/bun:1.4.2-alpine AS build
WORKDIR /app

# Install workspace dependencies first for layer caching.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
RUN bun install --frozen-lockfile

# Bundle main.js (server) and database/data-source.cli.js (TypeORM CLI).
COPY apps/api apps/api
RUN cd apps/api && bun run build

# --- runtime stage -----------------------------------------------------------
# Note: `bun install --production` is unreliable in Bun workspaces (it prunes
# to the ROOT manifest only), so the runtime stage installs production deps
# directly from the manifests instead of copying a pruned tree.
FROM oven/bun:1.4.2-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
RUN bun install --frozen-lockfile --production

# Bundle + entrypoint live under the workspace dir so module resolution finds
# the workspace's node_modules links (bun's isolated linker layout).
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/docker-entrypoint.sh ./docker-entrypoint.sh
COPY apps/api/package.json ./apps/api/package.json
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
