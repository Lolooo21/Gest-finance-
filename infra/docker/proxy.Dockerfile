# syntax=docker/dockerfile:1.7
# Image du proxy : construit le front (PWA) puis le sert avec Caddy, qui relaie l'API. HTTP interne seulement :
# le HTTPS est assuré en amont par Tailscale.

FROM node:22.12-bookworm-slim AS web-build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/finance-core/package.json packages/finance-core/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@gest-finance/web..."
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @gest-finance/web build

FROM caddy:2.8.4-alpine AS runtime
RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app app
COPY --from=web-build /app/apps/web/dist /srv
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
ENV XDG_DATA_HOME=/tmp/caddy-data \
    XDG_CONFIG_HOME=/tmp/caddy-config
USER app
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/health"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
