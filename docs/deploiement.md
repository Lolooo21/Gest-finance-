# Déploiement en production (VPS + Tailscale)

L'application tourne sur un petit serveur loué (VPS) **sans aucun port ouvert sur Internet**. Vous y accédez par un VPN privé,
[Tailscale](https://tailscale.com), depuis vos appareils (PC, téléphone). Les sauvegardes sont chiffrées sur le serveur puis
envoyées vers un stockage S3 externe.

```
Vos appareils ──(Tailscale, HTTPS)──► [VPS] tailscale ► proxy (Caddy) ► api ► postgres
                                                              └─ application (PWA)
                                          backup ──(chiffré avec age)──► stockage S3
```

> **État de validation** : les fichiers de ce dossier ont été testés par des tests automatiques (syntaxe, cohérence, scripts de
> sauvegarde/restauration sur un vrai PostgreSQL). La construction des images et le démarrage de la pile sont vérifiés par la CI
> GitHub (workflow « Images Docker »). **Le premier déploiement réel sur un VPS n'a pas encore été fait** : suivez ce guide pas à pas
> et signalez toute étape qui diffère.

## 0. Essayer sans VPS, sur votre PC
Avant de louer un serveur, vous pouvez faire tourner **toute la pile de production** (base, migrations, API, proxy, sauvegarde) sur votre PC avec Docker Desktop,
sans Tailscale (il est réservé au profil `prod`). Depuis **Git Bash** (fourni avec Git pour Windows) ou WSL, à la racine du projet :
```
winget install FiloSottile.age                      # une seule fois, puis rouvrez le terminal
sh infra/scripts/init-secrets.sh --local            # secrets de TEST (jamais à réutiliser en production)
docker compose -f infra/docker/compose.prod.yml -f infra/docker/compose.ci.yml up -d --build
docker compose -f infra/docker/compose.prod.yml -f infra/docker/compose.ci.yml ps        # tout doit être « healthy »
sh infra/scripts/smoke.sh                           # test de fumée : santé, en-têtes de sécurité, routes, parcours complet
```
Ouvrez ensuite <http://127.0.0.1:8080> : c'est exactement l'application de production (proxy Caddy, base migrée, secrets en fichiers).
- **Tester la sauvegarde** : `docker compose -f infra/docker/compose.prod.yml -f infra/docker/compose.ci.yml exec backup backup.sh`, puis copiez le
  fichier (`... cp backup:/backups/<fichier> .`) et testez la restauration avec la clé de test `secrets/age_identity_test.txt` (commande du § 8).
- **Arrêter et effacer** : `docker compose -f infra/docker/compose.prod.yml -f infra/docker/compose.ci.yml down -v` (le `-v` supprime la base de test).
- Si quelque chose échoue, envoyez-moi la sortie de `docker compose ... logs --tail=100` : c'est le premier vrai essai de ces fichiers sur une machine avec Docker.

Le reste (tests, CI) :
- `pnpm test` : tous les tests automatiques (126 au dernier décompte) ; `pnpm dev` : l'application de développement.
- **CI GitHub** : onglet **Actions** du dépôt. Chaque `git push` lance les workflows ; une coche verte = tout passe, une croix rouge = ouvrez le job pour lire l'erreur
  (ou demandez-moi : je lis les journaux et corrige).

## 1. Ce qu'il vous faut
- Un **VPS** (Debian 12 ou Ubuntu 24.04, 1 à 2 vCPU, 2 Go de mémoire, 20 Go de disque), chez un hébergeur européen (Scaleway, OVH, Hetzner…).
- Un compte **Tailscale** (gratuit pour un usage personnel) et le client installé sur vos appareils.
- Un **stockage S3** pour les sauvegardes (Scaleway Object Storage, OVH, Backblaze B2…) : un bucket privé et une clé d'accès dédiée.
- Sur votre PC : l'outil **age** (`winget install FiloSottile.age` sous Windows) pour créer la clé de chiffrement des sauvegardes.

## 2. Tailscale
1. Dans la console Tailscale → **DNS** : activez **MagicDNS** et **HTTPS Certificates**.
2. **Settings → Keys → Generate auth key** : clé à usage unique, expiration courte. Gardez-la pour l'étape 5.
3. Installez Tailscale sur votre PC et votre téléphone et connectez-vous au même compte.

## 3. Préparer le serveur
```
ssh vous@IP-du-serveur
sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh        # installe Docker et Docker Compose
sudo usermod -aG docker $USER && exit              # reconnectez-vous ensuite
```
Pare-feu : l'application n'a besoin d'**aucun port entrant**. Ne laissez ouvert que SSH (clés uniquement, pas de mot de passe)
ou, mieux, fermez-le aussi et passez par `tailscale ssh`.

## 4. Clé de chiffrement des sauvegardes (sur VOTRE PC, pas sur le serveur)
```
age-keygen -o cle-sauvegarde.txt
```
Le fichier contient la **clé privée** (`AGE-SECRET-KEY-...`) et affiche la **clé publique** (`age1...`).
- Rangez `cle-sauvegarde.txt` dans un gestionnaire de mots de passe **et** sur un support hors ligne : sans elle, vos sauvegardes sont définitivement illisibles.
- Ne l'envoyez jamais sur le serveur : seule la clé publique y est utilisée.

## 5. Installer l'application
```
git clone https://github.com/Lolooo21/Gest-finance-.git && cd Gest-finance-
sh infra/scripts/init-secrets.sh
```
Le script génère les mots de passe et clés, puis vous demande : la **clé publique age**, la **clé Tailscale** et (facultatif) les
informations du **stockage S3**. Il crée le dossier `secrets/` (accessible à vous seul, droits 700) et `infra/docker/.env`.

> **Sauvegardez le dossier `secrets/` séparément** (gestionnaire de mots de passe), en particulier `field_encryption_key` :
> elle chiffre les IBAN. Sans elle, une base restaurée contiendrait des IBAN illisibles. Le script ne régénère jamais un secret existant.

Démarrage :
```
docker compose -f infra/docker/compose.prod.yml --profile prod up -d --build
docker compose -f infra/docker/compose.prod.yml ps
```
Au bout de quelques minutes tous les services sont « healthy » (la base de données est migrée automatiquement). Ouvrez
`https://gest-finance.<nom-de-votre-réseau>.ts.net` depuis un appareil connecté à Tailscale (le nom exact est dans la console Tailscale),
puis **créez votre foyer** (inscription) et activez la double authentification.

## 6. Mise à jour et retour arrière
```
cd Gest-finance- && git pull
docker compose -f infra/docker/compose.prod.yml --profile prod up -d --build
```
Les migrations s'appliquent automatiquement. **Retour arrière** : `git checkout <version précédente>` puis la même commande. Une migration
de base n'est pas annulable automatiquement : en cas de problème de données, restaurez la dernière sauvegarde (§ 8).

## 7. Sauvegardes
- Chaque jour à **03:30 UTC** : copie de la base, chiffrement avec votre clé publique, conservation de 7 copies sur le serveur, envoi vers le S3
  (35 jours de sauvegardes quotidiennes, 12 mensuelles).
- Vérifier la dernière sauvegarde :
  ```
  docker compose -f infra/docker/compose.prod.yml exec backup cat /backups/last-success.txt
  ```
  La dernière ligne doit indiquer « copie distante OK ». « aucune copie distante » signifie que la sauvegarde ne survivrait pas à la perte du serveur.
- Lancer une sauvegarde tout de suite : `docker compose -f infra/docker/compose.prod.yml exec backup backup.sh`.
- **Testez une restauration** après l'installation, puis à intervalles réguliers : une sauvegarde jamais restaurée n'est pas une sauvegarde.

## 8. Restaurer
1. Récupérez un fichier `gest-AAAAMMJJ-HHMMSS.dump.age` (sur le serveur : `docker compose ... cp backup:/backups/<fichier> .`, ou depuis le S3).
2. Restaurez-le dans une **base de test** d'abord (le script refuse la base de production sans confirmation) :
   ```
   docker compose -f infra/docker/compose.prod.yml run --rm --no-deps -v "$PWD:/restore:ro" backup \
     restore.sh /restore/<fichier>.dump.age /restore/cle-sauvegarde.txt "postgresql://gest:$(cat secrets/postgres_password)@postgres:5432/gest_test"
   ```
   (créez d'abord la base : `docker compose ... exec postgres createdb -U gest gest_test`). Le script affiche le nombre de lignes par table.
3. **Perte complète du serveur** : installez un nouveau serveur (§ 3 à 5) en **réutilisant votre sauvegarde du dossier `secrets/`** (ou au minimum
   `field_encryption_key` et `jwt_secret`), démarrez seulement la base (`docker compose ... up -d postgres`), puis restaurez dans `gest_finance`
   avec `RESTORE_FORCE=yes` (variable d'environnement du conteneur : ajoutez `-e RESTORE_FORCE=yes` à la commande ci-dessus) avant de lancer le reste.

## 9. Sécurité : à retenir
- Aucun port n'est publié : le serveur n'est joignable que via Tailscale. Ne publiez jamais de port de la base ou de l'API.
- Les secrets sont des fichiers (dossier `secrets/` en 700, fermé aux autres utilisateurs du serveur), jamais dans les images ni dans Git.
- Gardez le serveur à jour (`apt upgrade`, redéploiement régulier) et activez la 2FA de chaque compte et celle de Tailscale.
- Limitez qui peut rejoindre votre réseau Tailscale : toute personne du réseau peut atteindre la page d'inscription.
- Supprimer l'accès d'un appareil perdu : console Tailscale → Machines → Remove.
