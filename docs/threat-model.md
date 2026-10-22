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
| Droits perdus à la restauration d'une sauvegarde | Les `GRANT` et politiques sont inclus dans la sauvegarde ; la restauration crée les rôles manquants ; test automatisé de comparaison des politiques et droits | Mots de passe des rôles à réappliquer (fait par le service de migration) |

## Production : réseau, secrets, sauvegardes (jalon 8a)
| Menace | Mesure | Risque résiduel |
|---|---|---|
| Attaque depuis Internet sur l'application ou la base | Aucun port publié ; accès uniquement via Tailscale (VPN privé, HTTPS) ; réseaux Docker internes ; base inaccessible hors du réseau `backend` | Compromission d'un appareil ou d'un compte Tailscale : activer la 2FA Tailscale, limiter les appareils |
| Évasion ou élévation de privilèges d'un conteneur | Utilisateurs non root, `read_only`, `cap_drop: ALL`, `no-new-privileges`, limites mémoire/CPU/processus, journaux limités | Vulnérabilité du noyau ou de Docker : garder le serveur à jour |
| Fuite de secrets (image, dépôt, processus) | Secrets en fichiers (600) montés en lecture seule, `*_FILE`, jamais dans `ENV`/`ARG` ni dans Git ; refus de démarrer avec les valeurs d'exemple ; Gitleaks et Trivy | Accès root au serveur : un attaquant lit les secrets en mémoire |
| Perte ou vol des sauvegardes | Chiffrées avec age par une clé publique : la clé privée n'est jamais sur le serveur ni chez le fournisseur S3 ; restauration vers la production bloquée sans confirmation ; test de restauration automatisé | Perte de la clé privée = sauvegardes définitivement illisibles ; perte de `field_encryption_key` = IBAN illisibles |
| Chaîne d'approvisionnement | Images de base versionnées (Dependabot), `--frozen-lockfile`, Trivy/hadolint/Semgrep/CodeQL, provenance, SBOM et signature cosign à la publication | Dépendance compromise non encore signalée |
| Inscription ouverte à tout le réseau privé | Réseau Tailscale restreint à vos appareils | Tout appareil du réseau peut créer un foyer : désactivation de l'inscription à prévoir |
