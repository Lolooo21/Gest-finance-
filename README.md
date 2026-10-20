# Gest-finance

PWA de gestion des finances du foyer : comptes bancaires, entrées et sorties (ponctuelles ou récurrentes), **reste à vivre** recalculé à chaque modification. Données sensibles : isolation par foyer, IBAN chiffré, 2FA.

> Ce README est mis à jour à chaque itération (schéma de base, fonctionnalités, démarrage). Le suivi détaillé est dans [`TODO.md`](TODO.md) (reste à faire) et [`DONE.md`](DONE.md) (réalisé, par fonction).

## Architecture
Monorepo pnpm, TypeScript partout.

| Dossier | Rôle |
|---|---|
| `apps/api` | API NestJS + Fastify, Prisma, PostgreSQL |
| `apps/web` | Front React + Vite + TanStack Query + Tailwind, PWA installable |
| `packages/finance-core` | Domaine pur, sans E/S : `occurrences()` (récurrences) et `resteAVivre()` |
| `packages/shared` | Schémas Zod partagés entre l'API et le front |
| `infra/docker` | PostgreSQL et Redis de développement |

## Base de données

```mermaid
erDiagram
    Household ||--o{ User : "membres"
    Household ||--o{ BankAccount : "possède"
    Household ||--o{ Transaction : "possède"
    Household ||--o{ RecurringRule : "possède"
    Household ||--o{ AuditLog : "journal"
    User ||--o{ RefreshToken : "sessions"
    User ||--o| ReminderSetting : "rappel hebdo"
    User ||--o{ PushSubscription : "appareils"
    BankAccount ||--o{ Transaction : "opérations"
    BankAccount ||--o{ RecurringRule : "récurrences"

    Household {
        uuid id PK
        string name
        datetime createdAt
    }
    User {
        uuid id PK
        uuid householdId FK
        string email UK
        string displayName
        string passwordHash "Argon2id"
        enum role "OWNER, ADULT, CHILD"
        string totpSecret "2FA"
        bool totpEnabled
        int failedLogins
        datetime lockedUntil
    }
    RefreshToken {
        uuid id PK
        uuid userId FK
        string tokenHash UK "SHA-256"
        datetime expiresAt
        datetime revokedAt
    }
    ReminderSetting {
        uuid userId PK,FK
        bool enabled
        int weekday "1 lundi … 7 dimanche"
        int hour
        string timezone "IANA"
        datetime since "pas de rappel rétroactif"
        datetime lastDoneAt "dernier bilan fait"
        datetime lastReminderAt "dernière notification"
    }
    PushSubscription {
        uuid id PK
        uuid userId FK
        string endpoint UK "service push du navigateur"
        string p256dh
        string auth
    }
    AuditLog {
        uuid id PK
        uuid householdId FK
        uuid userId
        string action "sans donnée financière"
        datetime createdAt
    }
    BankAccount {
        uuid id PK
        uuid householdId FK
        string name
        enum type "CHECKING, SAVINGS"
        int initialBalanceCents
        string ibanEncrypted "AES-256-GCM"
    }
    Transaction {
        uuid id PK
        uuid householdId FK
        uuid accountId FK
        int amountCents "signé : entrée +, sortie -"
        date date
        string label
    }
    RecurringRule {
        uuid id PK
        uuid householdId FK
        uuid accountId FK
        string label
        int amountCents "signé"
        enum frequency "WEEKLY, MONTHLY, YEARLY"
        date start
        date end "optionnelle"
    }
```

**Lecture du schéma.**
- Un **foyer** (`Household`) regroupe des **utilisateurs** (`User`, rôles `OWNER`, `ADULT`, `CHILD`) et toutes les données financières. Chaque table de données porte un `householdId` : toutes les requêtes de l'API sont filtrées par le foyer du jeton, jamais par un paramètre envoyé par le client.
- Un **compte bancaire** (`BankAccount`) porte un solde initial et un IBAN chiffré. Son **solde courant** n'est pas stocké : il est calculé = solde initial + opérations + occurrences de règles récurrentes déjà échues.
- Une **opération** (`Transaction`) est ponctuelle, en centimes signés (entrée positive, sortie négative).
- Une **règle récurrente** (`RecurringRule`) décrit un salaire, un loyer, un abonnement… (hebdomadaire, mensuel, annuel, avec fin optionnelle). Les occurrences ne sont pas stockées : `finance-core` les génère à la demande.
- `ReminderSetting` (une ligne par utilisateur) décrit son rappel hebdomadaire : jour, heure, fuseau. Le **créneau** du rappel est le dernier instant où tombent ce jour et cette heure ; le bilan est « dû » si ce créneau est postérieur à l'activation (`since`) et au dernier bilan fait (`lastDoneAt`). `lastReminderAt` garantit une seule notification par créneau.
- `PushSubscription` : un appareil abonné aux notifications. L'API n'envoie qu'aux services push connus des navigateurs (liste blanche anti-SSRF) ; la notification ne contient aucune donnée financière.
- `RefreshToken` stocke uniquement l'empreinte SHA-256 du jeton de session, avec rotation et révocation. `AuditLog` garde les actions (connexion, ajout…), sans montants ni secrets.

**Reste à vivre** = revenus (récurrents + ponctuels) − charges fixes récurrentes − dépenses ponctuelles, sur la période demandée (`GET /summary?from&to`), recalculé à chaque lecture donc après chaque ajout, modification ou suppression.

## Fonctionnalités en place

| Domaine | Fonctionnalité |
|---|---|
| Authentification | Inscription d'un foyer, connexion, déconnexion ; mot de passe Argon2id ; cookies HttpOnly + SameSite=Strict ; refresh token à rotation (réutilisation détectée = sessions révoquées) ; verrouillage 15 min après 5 échecs ; réponses identiques pour compte inconnu ou mauvais mot de passe |
| 2FA | Activation TOTP depuis le tableau de bord ; code exigé à la connexion ensuite |
| Foyer et rôles | Ajout de membres par le propriétaire ; `OWNER`/`ADULT` écrivent, `CHILD` en lecture seule ; journal d'audit (API, propriétaire) |
| Comptes | Création, liste (solde courant, IBAN masqué), modification, suppression ; IBAN chiffré AES-256-GCM |
| Opérations | Création, liste, modification, suppression ; le compte doit appartenir au foyer |
| Récurrences | Création, liste, modification (dont fin), suppression ; hebdo, mensuel, annuel |
| Reste à vivre | Calcul du mois en cours, recalculé après chaque changement |
| Rappel hebdomadaire | Jour, heure et fuseau au choix ; bannière « c'est l'heure de faire les comptes » dans l'appli ; notification push (si clés VAPID configurées) vérifiée chaque minute par un planificateur interne, une seule fois par créneau, sans rappel rétroactif |
| Bilan de la semaine | Écran en un coup d'œil : entrées et sorties des 7 derniers jours, récurrences échues, échéances des 7 jours à venir, reste à vivre du mois ; bouton « J'ai fait mes comptes » qui éteint le rappel ; ouvert directement depuis la notification |
| Confidentialité | Bouton « Masquer les montants » (mémorisé sur l'appareil) |
| Sécurité HTTP | Helmet (CSP stricte), limitation de débit (429), validation Zod de toutes les entrées, PWA sans cache des appels API |
| Tests | `finance-core` (13 tests, 100 %), API sur PostgreSQL réel (40 tests), front (22 tests) |

À venir (voir `TODO.md`) : lecture des fiches de paie (jalon 6), actualités financières, import de relevés et catégorisation, prévisionnel à 30/60/90 jours, passkeys, RLS PostgreSQL.

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

**Notifications push (optionnel).** Générez des clés VAPID (`cd apps/api && pnpm exec web-push generate-vapid-keys`) et renseignez-les dans `apps/api/.env` (voir `.env.example`). Le service worker n'est actif que dans la version construite : `pnpm --filter @gest-finance/web build` puis `pnpm --filter @gest-finance/web exec vite preview`. Sans clés, le rappel reste visible dans l'application.
