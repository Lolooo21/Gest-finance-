# DONE — réalisé

## Jalon 1 — Socle et domaine financier
### `packages/finance-core/src/recurrence.ts`
- `occurrences(rule, from, to)` : renvoie les dates d'une règle récurrente (WEEKLY/MONTHLY/YEARLY) dans [from, to], bornes incluses, en respectant la date de fin. Pour MONTHLY/YEARLY, un jour 31 est ramené au dernier jour des mois plus courts (31 → 28/30).
- `addMonths(base, months)` (interne) : ajoute des mois en UTC avec ce plafonnement du jour.
- Types `Frequency`, `RecurringRule` (montants en centimes, positif = revenu, négatif = dépense).

### `packages/finance-core/src/resteAVivre.ts`
- `resteAVivre(from, to, rules, oneOffs)` : fonction pure qui calcule revenus − charges fixes − dépenses ponctuelles sur la période ; renvoie `incomeCents`, `fixedChargesCents`, `oneOffExpensesCents`, `remainingCents`. À rappeler à chaque nouvelle entrée/sortie.

### Tests — `packages/finance-core/src/finance-core.test.ts`
5 tests unitaires (hebdo, fin de mois, borne de fin, calcul du reste à vivre, recalcul après nouvelle sortie), couverture 100 %.

### Infra et documentation
- `infra/docker/compose.dev.yml` : Postgres 16 + Redis 7 en réseau interne, secret pour le mot de passe.
- `.github/workflows/ci.yml` : lint, typecheck, tests, audit, Gitleaks.
- `docs/threat-model.md` : STRIDE v0 ; `README.md`, `CLAUDE.md`, `TODO.md`.

## Jalon 2 — Auth et foyer (`apps/api`, `packages/shared`)
### `packages/shared/src/index.ts`
- Schémas Zod partagés : `RegisterDto`, `LoginDto`, `TotpCodeDto`, `AddMemberDto`, `Role` (OWNER/ADULT/CHILD). Mot de passe ≥ 12 caractères, e-mail normalisé en minuscules.

### `apps/api/src/auth/auth.service.ts`
- `register(dto)` : crée le foyer et son propriétaire (hash Argon2id), journalise, ouvre une session.
- `login(dto)` : même erreur et même coût pour compte inconnu ou mauvais mot de passe ; exige le code TOTP s'il est activé ; verrouille 15 min après 5 échecs.
- `refresh(token)` : rotation du refresh token (stocké hashé SHA-256) ; la réutilisation d'un token déjà révoqué révoque toutes les sessions de l'utilisateur.
- `logout(token)` : révoque le refresh token.
- `setupTotp(userId)` / `enableTotp(userId, code)` : génère le secret puis active le 2FA après vérification d'un code.
- `hashPassword(password)` : Argon2id, réutilisé pour l'ajout de membres.

### `apps/api/src/auth/auth.controller.ts`
- `POST /auth/register|login|refresh|logout|2fa/setup|2fa/enable`. Cookies `access` (15 min) et `refresh` (14 j, chemin `/auth`) HttpOnly, SameSite=Strict, Secure en production.

### `apps/api/src/common/`
- `AuthGuard` : vérifie le JWT du cookie, applique `@Roles(...)`, le `householdId` vient toujours du jeton. `CurrentUser`, `ZodPipe` (validation d'entrée).

### `apps/api/src/household/household.controller.ts`
- `GET /household/members` (tous rôles), `POST /household/members` et `GET /household/audit` (OWNER seulement). Toutes les requêtes sont filtrées par le foyer du jeton.

### `apps/api/src/audit/audit.service.ts`
- `record(householdId, userId, action)` : journal d'actions sans donnée financière ni secret.

### `apps/api/src/app.ts`
- `createApp()` : Fastify, Helmet (CSP stricte), cookies, rate limiting (100 req/min par défaut).

### Tests — `apps/api/test/*.int.test.ts` (13 tests, Postgres réel)
Hash Argon2id et cookies, validation d'entrée, non-énumération des comptes, verrouillage, rotation/réutilisation du refresh token, déconnexion, 2FA, accès sans jeton ou jeton falsifié, rôles, isolation entre foyers (IDOR), journal sans secret, rate limiting 429, en-têtes de sécurité.

### Infra
- Schéma Prisma + migration `init` (Household, User, RefreshToken, AuditLog) ; CI avec service Postgres, `prisma generate` et `migrate deploy`.
