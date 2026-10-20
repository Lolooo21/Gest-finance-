# TODO — suivi d'avancement

Statuts : `À faire` · `En cours` · `En test` · `Terminé` (voir DONE.md)

## Socle
| Tâche | Statut |
|---|---|
| Monorepo pnpm, tsconfig, ESLint | Terminé |
| Compose dev (Postgres, Redis) | Terminé (non démarré/testé) |
| CI de base (lint, typecheck, tests, audit, Gitleaks) | En test (jamais exécutée sur GitHub) |
| Push GitHub | Terminé |
| Dockerfiles multi-stage non-root, compose prod + Caddy | À faire |
| CI complète : CodeQL, Semgrep, Trivy, e2e Playwright, ZAP | À faire |
| CD : build images GHCR signées, déploiement, rollback | À faire |

## Features
| Feature | Statut |
|---|---|
| Reste à vivre (`finance-core`) | Terminé (jalon 1) |
| Récurrences (expansion des occurrences) | Terminé (jalon 1) |
| Recalcul du reste à vivre à chaque entrée/sortie (`GET /summary`, recalculé à la lecture ; cache/événements à faire si besoin de perf) | Terminé (jalon 3) |
| Auth foyer : users, Argon2id, 2FA TOTP, rôles OWNER/ADULT/CHILD | Terminé (jalon 2) |
| Passkeys WebAuthn | À faire (reporté du jalon 2) |
| Page de consultation du journal d'audit (API prête : `GET /household/audit`) | À faire |
| Comptes bancaires (solde, opérations, IBAN chiffré) | Terminé (jalon 3) |
| Revenus/dépenses ponctuels et récurrents : création, liste, suppression | Terminé (jalon 3) |
| Modification d'un compte, d'une opération ou d'une règle (PATCH + édition en ligne) | Terminé (jalon 4) |
| Interface 2FA (activation TOTP depuis le tableau de bord) | Terminé (jalon 4) ; QR code à faire |
| Solde des comptes incluant les occurrences récurrentes échues | Terminé (jalon 4) |
| Occurrences récurrentes affichées dans l'historique des opérations | À faire |
| UI PWA (React/Vite, installable) : connexion, inscription, tableau de bord | Terminé (jalon 3) ; lecture hors-ligne à faire |
| Mode confidentialité (masquer les montants) | Terminé (jalon 3) |
| Messages d'erreur clairs, notifications, confirmations, boutons et actions rapides lisibles | Terminé |
| Accessibilité : audit complet (clavier, lecteur d'écran, contrastes) et tests Playwright | À faire |
| Interface : thème sombre, navigation par pages (comptes, opérations, paramètres) si l'écran devient trop long | À faire |
| Rappel hebdomadaire « faire les comptes » (planificateur interne + Web Push + bannière) | Terminé (jalon 5) |
| Bilan hebdomadaire interactif (entrées/sorties, récurrences, à venir, « bilan fait ») | Terminé (jalon 5) |
| Rappel : déplacer le planificateur dans un worker dédié (BullMQ) si plusieurs instances de l'API | À faire |
| Rappel : test réel des notifications sur appareil (clés VAPID, navigateur) | À faire — non vérifié ici |
| Rappel : écarts vs budget dans le bilan (dépend des enveloppes) | À faire |
| Documents : upload, antivirus, chiffrement | À faire |
| Lecture des fiches de paie (PDF numérique, parseur générique, validation humaine, anti-doublon, sans conservation) | Terminé (jalon 6) ; à confronter à de vraies fiches |
| Fiches de paie : OCR des scans et photos (Tesseract) | À faire |
| Fiches de paie : lecture robuste (espaces insécables, position des fragments, libellés élargis, plage de dates, employeur par forme juridique) | Terminé |
| Fiches de paie : parseurs par employeur / logiciel de paie selon vos vrais PDF | En cours : dépend de vos vrais PDF (utiliser `pnpm payslip:debug --anonymize`) |
| Fiches de paie : isoler l'extraction PDF dans un processus ou worker avec délai maximal | À faire |
| Fiches de paie : conservation chiffrée du PDF dans le coffre-fort | À faire |
| Page actualités financières : taux réglementés, indicateurs de marché automatiques, fiches d'épargne, simulateur d'intérêts | Terminé (jalon 7) ; appels réels BCE/Eurostat à vérifier chez vous (`pnpm market:check`) |
| Actualités : taux réglementés à mettre à jour à chaque arrêté (1er février / 1er août) ; taux du CEL non renseigné | À faire (récurrent) |
| Actualités : historique et graphiques des indicateurs, alerte quand un taux change | À faire |
| Actualités : comparaison des taux de crédit et simulateur de crédit conso/immo | À faire |
| Actualités : lecture automatique des taux réglementés depuis une source officielle (aujourd'hui saisie à la main) | À faire |

## Sécurité
| Tâche | Statut |
|---|---|
| Modèle de menaces v0 | Terminé |
| Garde `householdId` (issu du JWT) + tests IDOR | Terminé (jalon 2) |
| RLS PostgreSQL (défense en profondeur) | À faire (reporté du jalon 2) |
| Chiffrement AES-256-GCM de l'IBAN | Terminé (jalon 3) |
| Chiffrement des documents | À faire (avec le coffre-fort) |
| Rate limiting, Helmet/CSP, audit log | Terminé (jalon 2) |
| Journalisation des erreurs 5xx sans fuite de données + diagnostic de base non migrée au démarrage | Terminé |
| Sauvegardes chiffrées + runbook de restauration | À faire |

## Tests
| Tâche | Statut |
|---|---|
| Unitaires `finance-core` (100 %) | Terminé |
| Intégration API (Postgres réel) | Terminé en local (25 tests API) ; CI GitHub à vérifier |
| Tests du front (Vitest + Testing Library) | Terminé (16 tests) |
| E2E Playwright | À faire |
| Sécurité (SAST, DAST, dépendances, images) | À faire |

---

## Backlog d'idées (priorisé) — toutes `À faire`
Priorité : **P1** = MVP évolutif · **P2** = version 2 · **P3** = plus tard.

### Intelligence et automatisation (100 % local, aucune donnée envoyée à un tiers)
| Idée | Prio | Notes / ajustements |
|---|---|---|
| Import de relevés bancaires CSV/OFX (PDF en repli OCR) + rapprochement avec opérations déjà saisies | P1 | Parser par format, aperçu avant validation, empreinte (hash) par opération pour l'idempotence ; PDF plus tard car moins fiable |
| Catégorisation automatique (règles + apprentissage des corrections) | P1 | Règles par libellé/montant d'abord, puis classifieur léger local (naïve Bayes/TF-IDF) ; chaque correction crée ou ajuste une règle |
| Détection des doublons | P1 | Fait partie du rapprochement d'import (même date ± 2 j, montant, libellé proche) |
| Détection des abonnements et récurrences oubliées + alerte hausse de prix | P1 | Détecter les montants périodiques dans l'historique → proposer de créer une `RecurringRule` ; alerte si variation > seuil configurable |
| Détection d'anomalies (dépense inhabituelle, prime absente de la fiche de paie, prélèvement en double) | P2 | Comparer à la médiane par catégorie ; comparer fiche de paie courante à la précédente |

### Prévision et pilotage
| Idée | Prio | Notes / ajustements |
|---|---|---|
| Reste à vivre prévisionnel à 30/60/90 jours | P1 | Réutilise `occurrences()` et `resteAVivre()` de `finance-core` ; ajouter une fonction `projectBalance()` pure + alerte si solde projeté < 0 |
| Enveloppes et budgets par catégorie, alerte à 80 % du plafond | P1 | Alerte à 80 % et 100 %, report optionnel du reliquat au mois suivant |
| Provisions lissées des dépenses annuelles (impôts, assurances, vacances, rentrée) | P2 | Mensualité = montant annuel / 12 déduite du reste à vivre ; lien avec les enveloppes |
| Simulateur « et si ? » (crédit, changement de salaire, dépense ponctuelle) | P2 | Scénarios non persistés dans les vraies données, comparés au prévisionnel ; s'appuie sur `projectBalance()` |

### Spécifique à un foyer de 5
| Idée | Prio | Notes / ajustements |
|---|---|---|
| Multi-membres avec rôles, comptes individuels/joints, vues par personne | P1 | Étend le modèle `User`/RLS : rôles OWNER / ADULTE / ENFANT (lecture seule) ; propriété d'un compte = individuel ou joint |
| Argent de poche et objectifs des enfants (mode lecture seule) | P2 | Sous-compte virtuel par enfant, versement récurrent, vue simplifiée sans autres données du foyer |
| Suivi du coût par enfant (cantine, activités, santé) | P3 | Étiquette « bénéficiaire » sur les opérations plutôt qu'un modèle séparé |

### Objectifs et patrimoine
| Idée | Prio | Notes / ajustements |
|---|---|---|
| Objectifs d'épargne avec progression et versement mensuel conseillé | P2 | Versement conseillé = reste / mois restants, plafonné par le reste à vivre |
| Suivi du patrimoine net avec courbe d'évolution | P2 | Snapshot mensuel : comptes + épargne − crédits |
| Suivi des crédits : tableau d'amortissement, simulation de remboursement anticipé | P2 | Fonctions pures dans `finance-core` (mensualité, capital restant dû, économie d'intérêts) |

### Documents et rappels
| Idée | Prio | Notes / ajustements |
|---|---|---|
| Rappel hebdomadaire interactif : push → assistant « bilan de la semaine » en 2 minutes | P1 | Remplace le rappel simple : opérations à valider, écarts vs budget, reste à vivre ; état « bilan fait » enregistré |
| Coffre-fort de justificatifs (factures, contrats, garanties) avec rappels d'échéance (fin de garantie, résiliation d'assurance) | P2 | Réutilise le stockage chiffré des documents ; date d'échéance + alerte J-60/J-30 (loi Hamon / résiliation infra-annuelle) |
| OCR des tickets et factures (pas seulement fiches de paie) | P3 | Même pipeline worker local (Tesseract), validation humaine obligatoire |

### Sécurité et confiance
| Idée | Prio | Notes / ajustements |
|---|---|---|
| Passkeys WebAuthn (verrouillage biométrique) en plus ou à la place du TOTP | P1 | Intégré à l'auth dès le jalon 2 plutôt qu'en ajout tardif |
| Chiffrement des champs sensibles (E2E complet = option ultérieure) | P1 | E2E complet empêcherait parsing/catégorisation côté serveur et le reste à vivre : on garde le chiffrement applicatif des champs + volume chiffré ; E2E à reconsidérer plus tard |
| Mode confidentialité (masquer les montants d'un geste) | P1 | Purement front, quasi gratuit, stocké par appareil |
| Export complet et suppression des données (RGPD) + sauvegardes chiffrées automatiques | P1 | Export JSON/CSV + documents ; suppression vérifiée ; sauvegarde quotidienne chiffrée avec test de restauration en CI |
| Journal d'audit des accès et modifications (consultable par le propriétaire) | P1 | Déjà prévu en base ; ajouter une page de consultation |

### IA locale
| Idée | Prio | Notes / ajustements |
|---|---|---|
| Extraction fiches de paie et catégorisation en local (Tesseract + règles ; petit modèle auto-hébergé en option) | P1 | Conteneur worker sans accès réseau sortant ; modèle LLM local seulement si les règles sont insuffisantes |

### Simulateurs bancaires (ajout)
| Idée | Prio | Notes / faisabilité des données |
|---|---|---|
| Simulateur de crédit conso / immo : mensualité, coût total, TAEG, assurance, tableau d'amortissement, capacité d'emprunt (taux d'endettement ~35 %), impact sur le reste à vivre | P2 | **Calcul faisable à 100 % hors ligne** (formules d'annuité, fonctions pures dans `finance-core`, partagées avec le suivi des crédits). Taux indicatifs : taux d'usure et taux moyens publiés par la Banque de France (source publique, à vérifier), ajustables à la main. Taux réels par banque non disponibles librement : l'utilisateur saisit l'offre reçue |
| Comparateur de frais bancaires (banques en ligne et physiques) : coût annuel estimé selon l'usage du foyer (carte, retraits, virements, découvert, tenue de compte) | P3 | **Données moins faciles** : pas d'API ouverte unique ; les banques publient leurs tarifs en PDF (extrait standard des tarifs, format normalisé) et un comparateur public existe côté pouvoirs publics (à vérifier avant d'envisager un import). Approche : jeu de données **versionné et maintenu à la main** (`data/bank-fees.json`, date de mise à jour et source par banque, avertissement « indicatif »), puis calcul du coût annuel à partir de l'usage réel déduit des opérations importées. Pas de scraping |

## Sélection MVP évolutif (P1 prioritaires)
1. Import de relevés + catégorisation auto + doublons
2. Reste à vivre prévisionnel
3. Détection des abonnements et récurrences
4. Bilan hebdomadaire interactif
Puis sécurité de base (passkeys, mode confidentialité, export/suppression, audit).
