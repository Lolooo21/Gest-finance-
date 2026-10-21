# syntax=docker/dockerfile:1.7
# Image du proxy : construit le front (PWA) puis le sert avec Caddy, qui relaie l'API. HTTP interne seulement :
# le HTTPS est assuré en amont par Tailscale.

FROM node:22.23.3-bookworm-slim AS web-build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# pnpm via npm : le Corepack livré avec cette version de Node ne connaît pas les clés de signature actuelles du registre (erreur « Cannot find matching keyid »).
RUN npm install --global --no-fund --no-audit pnpm@10.28.0
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

FROM caddy:2.11.7-alpine AS runtime
RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app app
# Le binaire Caddy officiel porte une capacité de fichier (cap_net_bind_service) : avec « cap_drop: ALL » et « no-new-privileges »,
# son exécution est refusée (« exec caddy failed: Operation not permitted »). Une copie ne conserve pas cet attribut ;
# le port 8080 (> 1024) n'a de toute façon pas besoin de cette capacité.
RUN cp /usr/bin/caddy /usr/local/bin/caddy && chmod 755 /usr/local/bin/caddy
COPY --from=web-build /app/apps/web/dist /srv
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
ENV XDG_DATA_HOME=/tmp/caddy-data \
    XDG_CONFIG_HOME=/tmp/caddy-config
USER app
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/health"]
CMD ["/usr/local/bin/caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
