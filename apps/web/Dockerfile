FROM oven/bun:1.4.2-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/app/package.json apps/web/app/package.json
RUN bun install --frozen-lockfile
COPY apps/web/app apps/web/app
COPY LICENSE ./LICENSE
RUN bun run web:build

FROM caddy:2.11.9-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/app/dist /srv
EXPOSE 8080
