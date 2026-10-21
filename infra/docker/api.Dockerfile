# syntax=docker/dockerfile:1.7
# Image de l'API : même structure de dossiers que le développement (les paquets du workspace restent hors de
# node_modules, car le chargeur swc compile le TypeScript du workspace). Aucun secret n'est copié dans l'image.

FROM node:22.22.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# pnpm via npm : le Corepack livré avec cette version de Node ne connaît pas les clés de signature actuelles du registre (erreur « Cannot find matching keyid »).
RUN npm install --global --no-fund --no-audit pnpm@10.28.0
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
# OpenSSL doit être présent à la construction pour que Prisma détecte la bonne plateforme (debian-openssl-3.0.x).
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Le client ET le moteur de migration sont téléchargés ici : à l'exécution, le conteneur n'a ni Internet ni système de fichiers inscriptible.
RUN pnpm --filter @gest-finance/api exec prisma generate \
    && pnpm --filter @gest-finance/api exec prisma --version \
    && ( find /app/node_modules/.pnpm -path '*@prisma/engines/schema-engine-*' | grep -q . \
         || ( cd "$(find /app/node_modules/.pnpm -maxdepth 1 -name '@prisma+engines@*' | head -n1)/node_modules/@prisma/engines" \
              && node -e "require('./dist/index.js').ensureBinariesExist()" ) ) \
    && find /app/node_modules/.pnpm -path '*@prisma/engines/schema-engine-*' | grep .

FROM node:22.22.0-bookworm-slim AS runtime
# OpenSSL est requis par le moteur Prisma. La gestion des signaux et des processus orphelins est confiée à `init: true` (compose) ou `docker run --init`.
# Correctifs de sécurité Debian appliqués à la construction (l'image de base peut dater de quelques semaines).
RUN apt-get update \
    && apt-get -y upgrade \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    # npm, npx et Corepack ne servent qu'à la construction : les retirer supprime leurs modules embarqués (tar, brace-expansion...)
    # que les scanners signalent, et réduit la surface d'attaque.
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
              /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
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
CMD ["node", "--import", "@swc-node/register/esm-register", "src/main.ts"]
