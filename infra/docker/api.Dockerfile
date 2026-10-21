# syntax=docker/dockerfile:1.7
# Image de l'API : même structure de dossiers que le développement (les paquets du workspace restent hors de
# node_modules, car le chargeur swc compile le TypeScript du workspace). Aucun secret n'est copié dans l'image.

FROM node:22.12-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS build
# 1) Dépendances (couche mise en cache tant que les manifestes ne changent pas)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/finance-core/package.json packages/finance-core/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@gest-finance/api..."
# 2) Code puis client Prisma
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @gest-finance/api exec prisma generate

FROM node:22.12-bookworm-slim AS runtime
# OpenSSL est requis par le moteur Prisma ; tini gère les signaux et les processus orphelins.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    TRUST_PROXY=1 \
    HOME=/tmp
WORKDIR /app/apps/api
COPY --from=build --chown=node:node /app /app
# tsconfig autonome : le tsconfig du dépôt étend un fichier situé hors de l'image
COPY --chown=node:node infra/docker/api.tsconfig.json /app/apps/api/tsconfig.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=4s --start-period=40s --retries=5 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--import", "@swc-node/register/esm-register", "src/main.ts"]
