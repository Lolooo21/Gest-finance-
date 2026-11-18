# Modèle de menaces (v0, STRIDE simplifié)

| Menace | Mesure prévue |
|---|---|
| Usurpation (S) | Argon2id, 2FA TOTP, cookies HttpOnly/SameSite=Strict, rate limiting |
| Altération (T) | Validation Zod, transactions SQL, AuditLog |
| Répudiation (R) | AuditLog sans données financières |
| Fuite d'information (I) | TLS, AES-256-GCM sur IBAN/documents, RLS par foyer, logs filtrés, parsing 100 % local |
| Déni de service (D) | Rate limiting, limites de taille d'upload, jobs isolés dans le worker |
| Élévation de privilèges (E) | Garde `householdId`, rôles OWNER/MEMBER, conteneurs non-root |

## Import de fiches de paie (jalon 6)
| Menace | Mesure | Risque résiduel |
|---|---|---|
| PDF malveillant (exécution, bombe de décompression) | Taille 5 Mo, signature `%PDF-`, pdfjs sans `eval` ni polices système, 5 pages maximum, limitation à 10 imports/min, réservé OWNER/ADULT | L'extraction tourne dans le processus de l'API (pas de délai maximal) : à isoler dans un worker |
| Fuite des données de paie | Fichier lu en mémoire puis jeté, jamais écrit sur disque ; texte extrait jamais journalisé ; audit sans montants | Mémoire du processus pendant la lecture |
| Valeurs erronées enregistrées | Validation humaine obligatoire, indice de fiabilité, avertissements, anti-doublon | Une erreur de lecture validée sans contrôle |

## Indicateurs de marché (jalon 7)
| Menace | Mesure | Risque résiduel |
|---|---|---|
| Fuite de données du foyer vers l'extérieur | Seuls des appels GET sans cookie ni en-tête d'identification vers deux hôtes publics (BCE, Eurostat) ; aucune donnée personnelle dans les requêtes ; désactivable (`MARKET_REFRESH=off`) | L'adresse IP du serveur est visible de ces hôtes |
| SSRF (le serveur contacte une adresse choisie par un attaquant) | URL constantes dans le code, hôtes en liste blanche, https obligatoire, redirections refusées ; aucun paramètre utilisateur dans l'URL | Compromission du code source |
| Réponse malveillante ou démesurée d'une source | Délai de 10 s, taille limitée à 1 Mo, format SDMX-CSV strict, valeurs hors bornes de vraisemblance rejetées, dernière valeur valide conservée | Une source qui renverrait une valeur plausible mais fausse |
| Information obsolète présentée comme à jour | Statut « donnée ancienne » après 4 jours, alerte « taux périmés » après la période de validité, source et date affichées | Taux réglementés à mettre à jour à la main |
| Conseil en investissement involontaire | Avertissement permanent, contenu pédagogique sans promesse de rendement | Interprétation par l'utilisateur |

## Isolation entre foyers en base (jalon 8b)
| Menace | Mesure | Risque résiduel |
|---|---|---|
| Une requête oublie son filtre `householdId` et expose un autre foyer (IDOR, régression) | Sécurité par ligne PostgreSQL : le rôle `gest_app` ne voit que les lignes du foyer fixé pour la transaction ; sans foyer, accès refusé ; tests d'isolation en base réelle | Une faille qui permettrait de choisir le foyer fixé (le foyer vient uniquement du jeton signé) |
| Contournement de la RLS par une mauvaise configuration (URL du propriétaire ou d'un super-utilisateur) | L'API vérifie au démarrage son rôle (`gest_app`, sans `BYPASSRLS` ni super-utilisateur) ; en production, `DATABASE_OWNER_URL` est interdit dans l'API ; secrets séparés, le propriétaire n'est monté que dans le service de migration | Compromission du service de migration pendant son exécution (court, sans réseau sortant) |
| Abus du client « système » (connexion, audit, rappels) | Rôle `gest_system` aux droits minimaux : aucun accès aux comptes, opérations, règles ni fiches de paie ; journal d'audit en écriture seule | Accès aux utilisateurs, jetons de rafraîchissement et abonnements push (nécessaire à la connexion et aux rappels) |
| Altération du journal d'audit par l'application | `gest_app` n'a que la lecture, `gest_system` que l'insertion | Le propriétaire (migrations) peut modifier la table |
| Un membre du foyer lit les comptes personnels d'un autre (jalon 18) | Utilisateur du jeton fixé pour la transaction (`app.user_id`) ; RLS sur `BankAccount` (joint ou titulaire), et sur `Transaction`, `RecurringRule`, `PayslipImport` (compte visible) en lecture comme en écriture ; seul le propriétaire du foyer peut rendre personnel un compte joint ; tests en base réelle et par l'API (404 sur un identifiant deviné) | Données agrégées sans compte (catégories, budgets du foyer, objectifs d'épargne) restent communes ; les montants personnels n'entrent pas dans le calcul des autres membres |
| Export ou effacement des données par un tiers qui a pris une session ouverte (jalon 19) | Mot de passe redemandé pour l'export, l'effacement et le retrait d'un membre (échec compté, verrouillage au 5e, plafond des routes d'authentification) ; « SUPPRIMER » à taper ; effacement du foyer réservé au propriétaire ; export inscrit au journal, sans aucun secret ; `Cache-Control: no-store` | Le fichier exporté est en clair sur l'appareil de l'utilisateur ; les sauvegardes gardent les données effacées jusqu'à leur rotation (voir `docs/rgpd.md`) |
| Hameçonnage, mot de passe volé ou réutilisé (jalon 20) | Passkeys WebAuthn : liées au domaine (origine et rpID vérifiés), vérification de l'utilisateur exigée, clé privée jamais transmise ; défis aléatoires à usage unique, 5 min, gardés sur le serveur (le navigateur n'a qu'un identifiant en cookie HttpOnly) ; ajout d'une passkey soumis au mot de passe ; compte verrouillé refusé ; échecs journalisés ; plafond des routes d'authentification | Défis en mémoire : une seule instance de l'API ; le mot de passe reste une autre porte d'entrée (le désactiver n'est pas encore possible) |
| Saturation du serveur par des images à lire (OCR, jalon 22) | Une seule lecture à la fois (429 sinon), 60 s au plus puis arrêt du thread, 3 pages au plus par PDF scanné, 10 Mo par fichier, signature vérifiée (PDF, JPEG, PNG), 10 envois par minute et par IP, réservé aux adultes connectés ; Tesseract en WebAssembly (pas de code natif), sans réseau ni écriture disque | Une image piégée visant Tesseract/Leptonica reste confinée au moteur WebAssembly du thread ; mettre à jour `tesseract.js` avec Dependabot |
| Droits perdus à la restauration d'une sauvegarde | Les `GRANT` et politiques sont inclus dans la sauvegarde ; la restauration crée les rôles manquants ; test automatisé de comparaison des politiques et droits | Mots de passe des rôles à réappliquer (fait par le service de migration) |

## Production : réseau, secrets, sauvegardes (jalon 8a)
| Menace | Mesure | Risque résiduel |
|---|---|---|
| Attaque depuis Internet sur l'application ou la base | Aucun port publié ; accès uniquement via Tailscale (VPN privé, HTTPS) ; réseaux Docker internes ; base inaccessible hors du réseau `backend` | Compromission d'un appareil ou d'un compte Tailscale : activer la 2FA Tailscale, limiter les appareils |
| Évasion ou élévation de privilèges d'un conteneur | Utilisateurs non root, `read_only`, `cap_drop: ALL`, `no-new-privileges`, limites mémoire/CPU/processus, journaux limités | Vulnérabilité du noyau ou de Docker : garder le serveur à jour |
| Fuite de secrets (image, dépôt, processus) | Secrets en fichiers (600) montés en lecture seule, `*_FILE`, jamais dans `ENV`/`ARG` ni dans Git ; refus de démarrer avec les valeurs d'exemple ; Gitleaks et Trivy | Accès root au serveur : un attaquant lit les secrets en mémoire |
| Perte ou vol des sauvegardes | Chiffrées avec age par une clé publique : la clé privée n'est jamais sur le serveur ni chez le fournisseur S3 ; restauration vers la production bloquée sans confirmation ; test de restauration automatisé | Perte de la clé privée = sauvegardes définitivement illisibles ; perte de `field_encryption_key` = IBAN, libellés, employeurs et notes illisibles |
| Chaîne d'approvisionnement | Images de base versionnées (Dependabot), `--frozen-lockfile`, Trivy/hadolint/Semgrep/CodeQL, provenance, SBOM et signature cosign à la publication | Dépendance compromise non encore signalée |
| Inscription ouverte à tout le réseau privé | Réseau Tailscale restreint à vos appareils | Tout appareil du réseau peut créer un foyer : désactivation de l'inscription à prévoir |

## Durcissement de l'authentification et des requêtes (jalon 14)
| Menace | Mesure | Risque résiduel |
|---|---|---|
| Force brute sur la connexion | Verrouillage du compte 15 min après 5 échecs ; 10 tentatives d'authentification par minute et par IP (connexion, inscription, codes 2FA, changement et réinitialisation de mot de passe), compteur séparé du reste de l'API ; Argon2id ; même réponse et même coût pour un compte inconnu | Un attaquant du réseau Tailscale peut verrouiller un compte 15 min (déni de service ciblé) |
| Vraie IP du client masquée par les proxys | Caddy fait confiance aux seuls proxys internes (plages privées et Tailscale `100.64.0.0/10`) et transmet l'IP du client (`{client_ip}`) : chaque appareil a son propre compteur | À vérifier au premier déploiement : si Tailscale ne transmet pas l'IP, tous les appareils partagent un compteur |
| Rejeu d'un code 2FA intercepté | Dernier pas TOTP accepté mémorisé (`totpLastStep`) : un code ne sert qu'une fois, fenêtre de tolérance de ± 30 s | — |
| Mot de passe faible | 12 caractères minimum ; refus des mots très courants, des mots de passe faits de chiffres ou de caractères répétés, et de ceux qui reprennent le nom, l'e-mail ou le foyer (inscription, ajout de membre, changement, réinitialisation) | Pas de vérification contre les bases de mots de passe divulgués (aucun appel externe, par choix) |
| CSRF (requête forgée depuis un autre site) | Cookies `SameSite=Strict` ; en plus, toute requête qui modifie des données est refusée (403) si le navigateur la déclare inter-sites (`Sec-Fetch-Site`) ou si son `Origin` n'est ni l'hôte appelé, ni `APP_URL`, ni une origine de `CSRF_TRUSTED_ORIGINS` ; pas de CORS | — |
| Injection SQL | Requêtes Prisma paramétrées ; les seules requêtes brutes sont des modèles balisés (paramétrés) ; un test échoue si `$queryRawUnsafe`, `$executeRawUnsafe` ou `Prisma.raw(` apparaît dans l'API ; RLS en défense en profondeur | `scripts/setup-roles.mjs` construit un `ALTER ROLE` (les mots de passe ne peuvent pas y être paramétrés) : valeur fournie par l'administrateur, apostrophes échappées, hors API |
| Jeton d'accès volé ou session à couper | Version de session dans le jeton, relue à chaque requête : changement ou réinitialisation de mot de passe et réutilisation d'un jeton de rafraîchissement volé coupent aussitôt tous les jetons d'accès ; algorithme JWT imposé (HS256, ni `none` ni autre) | Après une simple déconnexion, un jeton d'accès copié reste valable jusqu'à 15 min |
| Inscription d'inconnus | Inscription ouverte seulement tant qu'aucun foyer n'existe (première installation), sauf `ALLOW_REGISTRATION=1` ; les membres sont ajoutés par le propriétaire | — |
| Données financières en cache | `Cache-Control: no-store` sur toutes les réponses de l'API ; le service worker ne met jamais l'API en cache | — |
| XSS | React échappe tout le texte ; aucun `dangerouslySetInnerHTML` ; CSP stricte (`script-src 'self'`) ; cookies HttpOnly | — |

### Risques résiduels à connaître
- **Données en base** (jalon 21) : l'IBAN, les libellés des opérations et des récurrences, l'employeur des fiches de paie et la note des versements d'épargne sont chiffrés champ par champ (AES-256-GCM, IV aléatoire, clé `field_encryption_key` hors de la base). Un dump volé sans la clé ne révèle ni à qui ni pour quoi l'argent a été dépensé. Restent en clair, parce que PostgreSQL les additionne et les trie : les montants, les dates, les noms de comptes, de catégories et d'objectifs, et les mots-clés des règles de catégorisation (protégés par la RLS, les droits des rôles et l'absence de port ouvert). La clé est dans la mémoire de l'API : une compromission de l'API en fonctionnement donne accès aux données en clair. Les sauvegardes sont chiffrées. Pour le disque du VPS, préférez un hébergement avec disque chiffré et ne gardez jamais `secrets/` hors du serveur sans chiffrement.
- **Réseau Tailscale** : toute personne admise sur le réseau atteint l'application ; n'y invitez que le foyer, activez la 2FA du compte Tailscale.
- **Lecture des PDF** dans le processus de l'API (fiches de paie) : à isoler dans un processus avec délai maximal (voir `TODO.md`).
- **Pas de test d'intrusion dynamique** (DAST) automatisé : ZAP est prévu dans la CI.
