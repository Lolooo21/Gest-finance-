# Gest-finance

PWA de gestion des finances du foyer (reste à vivre, récurrences, comptes ; fiches de paie et actualités à venir).
Monorepo pnpm TypeScript : NestJS + Fastify + Prisma + PostgreSQL (`apps/api`), React + Vite PWA (`apps/web`), domaine pur (`packages/finance-core`), schémas partagés (`packages/shared`).

## Démarrage (développement)
Prérequis : Node 22+, pnpm 10, Docker.
```
pnpm install
docker compose -f infra/docker/compose.dev.yml up -d     # PostgreSQL + Redis
copy apps\api\.env.example apps\api\.env                  # (cp sous Linux/macOS)
cd apps/api && pnpm exec prisma migrate deploy && cd ../..
pnpm dev                                                  # API :3000 + front http://localhost:5173
pnpm test
```
Suivi d'avancement : `TODO.md` et `DONE.md`.
