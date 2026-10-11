# TODO — suivi d'avancement

Statuts : `À faire` · `En cours` · `En test` · `Terminé` (voir DONE.md)

## Socle
| Tâche | Statut |
|---|---|
| Monorepo pnpm, tsconfig, ESLint | Terminé |
| Compose dev (Postgres, Redis) | Terminé (non démarré/testé) |
| CI de base (lint, typecheck, tests, audit, Gitleaks) | En test (jamais exécutée sur GitHub) |
| Push GitHub (erreur 403 : app Claude non installée sur le dépôt) | En cours — bloqué côté utilisateur |
| Dockerfiles multi-stage non-root, compose prod + Caddy | À faire |
| CI complète : CodeQL, Semgrep, Trivy, e2e Playwright, ZAP | À faire |
| CD : build images GHCR signées, déploiement, rollback | À faire |

## Features
| Feature | Statut |
|---|---|
| Reste à vivre (`finance-core`) | Terminé (jalon 1) |
| Récurrences (expansion des occurrences) | Terminé (jalon 1) |
| Recalcul événementiel à chaque entrée/sortie (API + cache) | À faire |
| Auth foyer : users, Argon2id, 2FA TOTP, rôles | À faire |
| Comptes bancaires (solde, opérations, IBAN chiffré) | À faire |
| CRUD revenus/dépenses ponctuels et récurrents | À faire |
| UI PWA (React/Vite, offline, installable) | À faire |
| Rappel hebdomadaire « faire les comptes » (BullMQ + Web Push) | À faire |
| Documents : upload, antivirus, chiffrement | À faire |
| Lecture fiches de paie (PDF, OCR repli, validation humaine) | À faire |
| Page actualités financières (taux, actifs d'épargne) | À faire |

## Sécurité
| Tâche | Statut |
|---|---|
| Modèle de menaces v0 | Terminé |
| RLS PostgreSQL + garde `householdId` + tests IDOR | À faire |
| Chiffrement AES-256-GCM (IBAN, documents) | À faire |
| Rate limiting, Helmet/CSP, audit log | À faire |
| Sauvegardes chiffrées + runbook de restauration | À faire |

## Tests
| Tâche | Statut |
|---|---|
| Unitaires `finance-core` (100 %) | Terminé |
| Intégration API (Testcontainers) | À faire |
| E2E Playwright | À faire |
| Sécurité (SAST, DAST, dépendances, images) | À faire |
