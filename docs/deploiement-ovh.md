# Déploiement en production sur OVH (VPS, domaine, SMTP, Portainer)

Ce guide complète [`deploiement.md`](deploiement.md), qui reste la référence pour chaque commande : il couvre les achats et comptes
(OVHcloud, nom de domaine, e-mail, Tailscale, stockage S3) et l'outil de supervision Portainer.

## Vue d'ensemble

Gest-finance tourne sur un VPS OVH **sans aucun port ouvert sur Internet** : vous, votre famille et l'administration (Portainer, SSH)
passez par le réseau privé Tailscale. Le nom de domaine ne sert qu'à **envoyer les e-mails** (lien « mot de passe oublié ») avec une
adresse d'expéditeur fiable ; il n'expose pas l'application.

- **Public** : rien côté serveur. Seuls partent vers l'extérieur les e-mails (via votre fournisseur SMTP) et les sauvegardes chiffrées (vers le stockage S3).
- **Privé (Tailscale)** : l'application `https://gest-finance.<votre-réseau>.ts.net`, Portainer et SSH.
- **Sur le serveur** : la pile Docker du dépôt (`infra/docker/compose.prod.yml`) : PostgreSQL, migrations, API, proxy Caddy, Tailscale,
  sauvegarde ; Portainer à côté pour surveiller.

```
                       ┌──────────────── VPS OVH · aucun port ouvert ────────────────┐
Vos appareils ──HTTPS──► gest-finance (Tailscale) ──► Proxy Caddy (application)       │
(PC, téléphones,       │                                   │                          │
 réseau Tailscale)     │                                   ▼                          │
      │                │                                  API ─────────────────────────► Serveur SMTP (OVH ou Brevo)
      │                │                                   │                          │
      │                │                                   ▼                          │
      └─────SSH────────► vps-ovh (Tailscale)          PostgreSQL                      │
                       │      │                            │                          │
                       │      ▼                            ▼                          │
                       │  Portainer                  Sauvegarde (chiffrée age) ────────► Stockage S3 (OVH, France)
                       └─────────────────────────────────────────────────────────────┘
```

Les deux seules entrées sont des machines Tailscale (l'application et l'administration) ; les seules sorties sont les e-mails et les
sauvegardes chiffrées.

**Prérequis** : une version de `main` qui contient le jalon 12 (envoi d'e-mails, secret `smtp_url`).

## Budget et comptes à créer

Comptez environ **6 à 10 € par mois** au total, presque tout chez OVHcloud. Les prix sont **approximatifs** (non vérifiés à la date
d'écriture) : contrôlez-les au moment de commander.

| Service | Compte | Usage | Coût indicatif |
| --- | --- | --- | --- |
| VPS | OVHcloud | Le serveur | ~5 à 7 € HT / mois |
| Nom de domaine `.fr` | OVHcloud | Adresse d'expéditeur des e-mails | ~7 à 12 € / an |
| Boîte e-mail ou relais SMTP | OVHcloud (avec le domaine) ou Brevo | Envoi du lien « mot de passe oublié » | 0 à 2 € / mois |
| Object Storage S3 | OVHcloud | Sauvegardes chiffrées hors du serveur | quelques centimes / mois |
| Réseau privé | Tailscale | Accès à l'application et à l'administration | Gratuit (offre Personal, 3 utilisateurs) ; payant au-delà |
| Supervision | Portainer CE (auto-hébergé) | Voir conteneurs, journaux, redémarrer | Gratuit |
| Code | GitHub (déjà en place) | Récupérer l'application sur le serveur | Gratuit |

**Point d'attention Tailscale** : l'offre gratuite couvre 3 utilisateurs. Pour un foyer de 5, soit les enfants utilisent un appareil
partagé connecté avec un compte parent, soit vous passez à l'offre payante familiale. Vérifiez les conditions actuelles sur
tailscale.com/pricing.

Activez la double authentification sur **chaque** compte (OVHcloud, Tailscale ou son fournisseur d'identité, Brevo, GitHub) : ils
donnent tous un accès direct à vos données ou à votre serveur.

## Acheter le VPS OVH

Prenez **la plus petite offre VPS de la gamme actuelle, avec au moins 4 Go de mémoire, hébergée en France**. La pile tient dans 2 Go,
mais la construction des images sur le serveur et Portainer demandent de la marge.

| Choix | Valeur conseillée | Pourquoi |
| --- | --- | --- |
| Mémoire | 4 Go minimum (8 Go confortable) | Construction des images (`--build`) + PostgreSQL + Portainer |
| Processeur | 2 vCores ou plus | Construction des images en quelques minutes |
| Disque | 40 Go SSD ou plus | Images Docker, base, 7 sauvegardes locales |
| Localisation | France (Gravelines, Roubaix ou Strasbourg) | Données financières en France, latence faible |
| Système | Debian 12 ou Ubuntu 24.04 LTS | Versions testées par le script Docker du guide |
| Accès | Votre **clé SSH publique** ajoutée à la commande | Pas de mot de passe root envoyé par e-mail |
| Engagement | Mensuel au début | Changer de taille sans pénalité |

1. Sur votre PC, créez une clé SSH si vous n'en avez pas : `ssh-keygen -t ed25519 -C "vps-gest-finance"`. Copiez le contenu de `~/.ssh/id_ed25519.pub`.
2. Sur ovhcloud.com, créez votre compte (vérifiez l'identité et activez la double authentification dans *Mon compte → Sécurité*).
3. *Bare Metal Cloud → VPS → Commander* : choisissez l'offre, la localisation et le système, collez la clé SSH publique, payez.
4. À la livraison (quelques minutes), notez **l'adresse IPv4** et le nom d'utilisateur créé par OVH (en général `debian` ou `ubuntu`, avec `sudo`).
5. Première connexion : `ssh debian@<IPv4>`. En cas de souci, la console **KVM** du manager OVH reste disponible sans réseau.

Pensez à la **sauvegarde automatisée** ou aux **snapshots** OVH (options payantes du VPS) : ils complètent les sauvegardes de la base
pour remettre le serveur entier en route rapidement.

## Nom de domaine et DNS

Le domaine sert à **signer vos e-mails** : sans SPF, DKIM et DMARC, le lien « mot de passe oublié » finira dans les indésirables.
**Ne créez aucun enregistrement A vers le VPS** : l'application reste joignable uniquement par Tailscale.

1. Chez OVHcloud : *Web Cloud → Noms de domaine → Commander*, par exemple `mon-foyer.fr`. Laissez la zone DNS gérée par OVH.
2. Choisissez l'adresse d'expéditeur : `no-reply@mon-foyer.fr`.
3. Ajoutez les enregistrements ci-dessous dans *Zone DNS* (les valeurs exactes de SPF et DKIM dépendent du fournisseur SMTP choisi).

| Type | Nom | Valeur | Rôle |
| --- | --- | --- | --- |
| MX | (racine) | Fourni par OVH si vous prenez leur boîte e-mail | Recevoir les réponses et les retours d'erreur |
| TXT | (racine) | `v=spf1 include:mx.ovh.com ~all` (OVH) ou l'include donné par Brevo | SPF : serveurs autorisés à envoyer pour le domaine |
| TXT ou CNAME | sélecteur `._domainkey` | Fourni par le fournisseur (activation DKIM dans son interface) | DKIM : signature des e-mails |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:vous@mon-foyer.fr` | DMARC : politique et rapports |

Commencez DMARC en `p=none` ; après deux semaines sans rapport d'échec, passez à `p=quarantine`. Un seul enregistrement SPF par domaine :
s'il en existe déjà un, ajoutez l'include dedans. Comptez jusqu'à quelques heures de propagation.

## Préparer et sécuriser le serveur

En 15 minutes : système à jour, SSH par clé uniquement, mises à jour de sécurité automatiques, pare-feu fermé sauf SSH, Docker installé.

```
ssh debian@<IPv4>
sudo apt update && sudo apt -y upgrade
sudo apt -y install unattended-upgrades ufw git openssl age
sudo dpkg-reconfigure -plow unattended-upgrades      # répondre Oui

# SSH : clé uniquement, pas de root
sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh

# Pare-feu : rien d'entrant sauf SSH (fermé aussi une fois Tailscale SSH validé)
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow OpenSSH && sudo ufw enable

# Docker et Docker Compose
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && exit                 # puis reconnectez-vous
```

- Gardez une seconde session SSH ouverte pendant ces réglages : si la nouvelle connexion échoue, vous corrigez depuis l'ancienne (sinon : console KVM du manager OVH).
- Docker contourne `ufw` pour les ports publiés : c'est pourquoi la pile n'en publie **aucun**, et Portainer n'écoute que sur `127.0.0.1`.
- En complément, le **pare-feu réseau** OVH (manager → IP → Firewall) peut bloquer tout l'entrant avant même le serveur.

## Tailscale

Deux machines apparaissent dans votre réseau privé : **`gest-finance`** (le conteneur Tailscale de la pile, qui sert l'application en
HTTPS) et **le VPS lui-même** (pour SSH et Portainer).

1. Créez le compte sur tailscale.com (connexion par Google, Microsoft ou GitHub : activez la double authentification chez ce fournisseur).
2. Console → **DNS** : activez **MagicDNS** et **HTTPS Certificates**. Notez le nom de votre réseau (`xxxx.ts.net`).
3. Console → **Settings → Keys → Generate auth key** : usage unique, expiration courte. Elle sera demandée par `init-secrets.sh` (application).
4. Sur le VPS (administration) :
    ```
    curl -fsSL https://tailscale.com/install.sh | sh
    sudo tailscale up --ssh --hostname vps-ovh
    sudo ufw allow in on tailscale0      # tout le trafic venant du réseau privé
    ```
    Ouvrez le lien affiché pour autoriser la machine.
5. Installez Tailscale sur votre PC et vos téléphones, connectés au même compte (ou invités dans le réseau).
6. Testez `ssh debian@vps-ovh` depuis votre PC via Tailscale. Si cela fonctionne, fermez SSH côté Internet : `sudo ufw delete allow OpenSSH`.

Toute personne de votre réseau Tailscale peut ouvrir la page d'inscription de l'application : n'y invitez que votre foyer, et retirez
tout appareil perdu (*Machines → Remove*).

## Portainer

Portainer CE sert à **surveiller et piloter** les conteneurs (état, journaux, redémarrage, ressources) depuis un navigateur. Il n'écoute
que sur le serveur lui-même et n'est publié que dans votre réseau Tailscale. Le « compte » Portainer est l'administrateur que vous créez
au premier accès : il n'y a pas d'inscription en ligne.

```
docker volume create portainer_data
docker run -d --name portainer --restart=always \
  -p 127.0.0.1:9443:9443 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data \
  portainer/portainer-ce:lts

# Publication HTTPS dans le réseau privé uniquement : https://vps-ovh.<votre-réseau>.ts.net
sudo tailscale serve --bg --https=443 https+insecure://127.0.0.1:9443
```

1. Dans les **5 minutes** qui suivent le démarrage, ouvrez `https://vps-ovh.<votre-réseau>.ts.net` et créez l'administrateur (mot de
   passe de 16 caractères ou plus, dans votre gestionnaire). Passé ce délai, Portainer se verrouille par sécurité : `docker restart portainer` puis recommencez.
2. Choisissez l'environnement **Docker local**.
3. *Stacks* affiche `docker` (la pile Gest-finance) en contrôle limité : c'est voulu. **Déployez et mettez à jour en ligne de commande**
   (section « Mises à jour »), car la pile lit ses secrets dans le dossier `secrets/` du dépôt, que Portainer ne gère pas.
4. Utilisez Portainer pour : vérifier que tous les conteneurs sont *healthy*, lire les journaux de `api` et `backup`, redémarrer un conteneur.

Portainer a un accès total à Docker (donc au serveur) : ne l'exposez jamais sur Internet et gardez-le à jour
(`docker pull portainer/portainer-ce:lts`, puis recréez le conteneur).

## SMTP (e-mails)

Le plus simple : **une boîte `no-reply@mon-foyer.fr` chez OVH**, utilisée en SMTP authentifié. Brevo (relais d'envoi français, offre
gratuite à volume limité) est l'alternative si vous voulez un service dédié à l'envoi. L'application n'envoie que quelques e-mails par mois.

| | Boîte OVH | Brevo |
| --- | --- | --- |
| Création | Manager → *Web Cloud → E-mails* sur le domaine → créer `no-reply@` | Compte Brevo → ajouter et authentifier le domaine (SPF, DKIM fournis) → *SMTP & API* → clé SMTP |
| Serveur | `ssl0.ovh.net`, port 465 (SSL) | `smtp-relay.brevo.com`, port 587 |
| Identifiant | L'adresse complète | L'identifiant SMTP affiché par Brevo |
| `smtp_url` | `smtps://no-reply%40mon-foyer.fr:MOTDEPASSE@ssl0.ovh.net:465` | `smtp://IDENTIFIANT:CLE_SMTP@smtp-relay.brevo.com:587` |

Vérifiez les noms de serveur et ports affichés dans l'interface de votre fournisseur au moment de la configuration.

**Encodez les caractères spéciaux** de l'identifiant et du mot de passe dans l'URL : `@` devient `%40`, `:` devient `%3A`, `/` devient
`%2F`, `#` devient `%23`. Le plus simple est un mot de passe long fait seulement de lettres et de chiffres.

Sur le serveur, à la racine du dépôt (le script `init-secrets.sh` le propose aussi) :

```
printf '%s' 'smtps://no-reply%40mon-foyer.fr:MOTDEPASSE@ssl0.ovh.net:465' > secrets/smtp_url
chmod 644 secrets/smtp_url
```

Puis dans `infra/docker/.env` :

```
MAIL_FROM=Gest-finance <no-reply@mon-foyer.fr>
APP_URL=https://gest-finance.<votre-réseau>.ts.net
```

`APP_URL` est l'adresse des liens envoyés : l'API refuse de démarrer si `smtp_url` est renseigné sans `APP_URL` en https. **Test** : sur
l'écran de connexion, « Mot de passe oublié ? » avec votre adresse ; l'e-mail arrive en moins d'une minute. Sinon, lisez les journaux de
`api` dans Portainer (ligne « Envoi d'e-mail impossible » avec la raison).

## Installer Gest-finance

L'installation tient en trois commandes une fois les comptes prêts ; prévoyez 20 minutes, construction des images comprise.

1. **Sur votre PC** (jamais sur le serveur), créez la clé de chiffrement des sauvegardes : `age-keygen -o cle-sauvegarde.txt`. Rangez ce
   fichier dans votre gestionnaire de mots de passe **et** hors ligne ; notez la clé publique `age1…` affichée.
2. Sur le serveur :
    ```
    git clone https://github.com/Lolooo21/Gest-finance-.git && cd Gest-finance-
    sh infra/scripts/init-secrets.sh
    ```
    Le script demande la clé publique age, la clé Tailscale, le stockage S3 (section « Sauvegardes ») et le SMTP (section « SMTP »). Il ne
    régénère jamais un secret existant.
3. Complétez `infra/docker/.env` (`MAIL_FROM`, `APP_URL`).
4. Démarrez :
    ```
    docker compose -f infra/docker/compose.prod.yml --profile prod up -d --build
    docker compose -f infra/docker/compose.prod.yml ps
    ```
    Tous les services doivent passer « healthy » (aussi visible dans Portainer).
5. Depuis un appareil du réseau Tailscale, ouvrez `https://gest-finance.<votre-réseau>.ts.net`, **créez votre foyer** puis activez la
   **double authentification**. Ajoutez ensuite les membres du foyer depuis l'application.
6. **Sauvegardez le dossier `secrets/`** dans votre gestionnaire de mots de passe, surtout `field_encryption_key` (chiffre les IBAN, les libellés des opérations, les employeurs et les notes) et
   `jwt_secret` : sans eux, une sauvegarde restaurée sur un nouveau serveur serait en partie illisible.

## Sauvegardes

Chaque nuit à 03:30 UTC, la base est copiée, chiffrée avec votre clé publique age, gardée sur le serveur (7 copies) et envoyée vers le
stockage S3. **Une sauvegarde jamais restaurée n'est pas une sauvegarde** : testez la restauration dès l'installation.

1. Manager OVH → *Public Cloud* (un projet est créé la première fois) → **Object Storage** → créez un conteneur S3 privé, en France, par
   exemple `gest-finance-sauvegardes`.
2. *Utilisateurs S3* : créez un utilisateur dédié et notez sa **clé d'accès** et sa **clé secrète** ; donnez-lui les droits sur ce seul conteneur.
3. Notez l'**endpoint** et la **région** affichés par le manager pour ce conteneur.
4. Donnez ces quatre informations à `init-secrets.sh` (question « Configurer le stockage S3 »).
5. Après le premier démarrage, lancez une sauvegarde et vérifiez qu'elle est partie :
    ```
    docker compose -f infra/docker/compose.prod.yml exec backup backup.sh
    docker compose -f infra/docker/compose.prod.yml exec backup cat /backups/last-success.txt
    ```
    La dernière ligne doit dire « copie distante OK ».
6. Restaurez-la dans une base de test avec votre clé privée (commande du § 8 de [`deploiement.md`](deploiement.md)) et comparez le nombre
   de lignes. Refaites ce test tous les trois mois.

## Mises à jour et surveillance

Une mise à jour = une nouvelle version fusionnée dans `main`, puis trois commandes sur le serveur ; les migrations de base s'appliquent seules.

```
cd ~/Gest-finance- && git pull
sh infra/scripts/init-secrets.sh                      # crée seulement les secrets ajoutés par la version
docker compose -f infra/docker/compose.prod.yml --profile prod up -d --build
```

- **Avant** : lancez une sauvegarde (`exec backup backup.sh`) et, si vous avez l'option, un snapshot OVH du VPS.
- **Retour arrière** : `git checkout <version précédente>` puis la même commande `up`. Une migration de base ne s'annule pas : en cas de
  problème de données, restaurez la sauvegarde faite juste avant.
- **Système** : les correctifs de sécurité s'installent seuls (`unattended-upgrades`) ; redémarrez le VPS une fois par mois si un noyau a
  été mis à jour (`/var/run/reboot-required`).
- **Chaque semaine (2 minutes, dans Portainer)** : tous les conteneurs *healthy*, pas d'erreur répétée dans les journaux de `api`, dernière
  ligne de `last-success.txt` datée de la nuit.
- Les alertes automatiques (sauvegarde trop ancienne, conteneur arrêté) ne sont pas encore en place : elles sont dans `TODO.md`.

## Checklist finale et dépannage

- [ ] Version de `main` contenant le jalon 12 (envoi d'e-mails)
- [ ] Double authentification active sur OVHcloud, Tailscale (ou son fournisseur d'identité), Brevo, GitHub
- [ ] VPS commandé en France, SSH par clé uniquement, `ufw` actif, mises à jour automatiques
- [ ] Tailscale sur le VPS et vos appareils ; SSH fermé côté Internet
- [ ] Domaine avec SPF, DKIM et DMARC ; aucun enregistrement A vers le VPS
- [ ] Portainer accessible seulement via `https://vps-ovh.<réseau>.ts.net`, administrateur créé
- [ ] Pile démarrée, tous les conteneurs *healthy*
- [ ] Foyer créé, double authentification activée dans l'application, membres ajoutés
- [ ] E-mail « mot de passe oublié » reçu (et pas dans les indésirables)
- [ ] Première sauvegarde « copie distante OK » et restauration testée
- [ ] Dossier `secrets/` et `cle-sauvegarde.txt` rangés hors du serveur

| Symptôme | Cause probable | Solution |
| --- | --- | --- |
| `docker compose` refuse de démarrer : *secret file not found* | Secret ajouté par une nouvelle version (ex. `smtp_url`) | `sh infra/scripts/init-secrets.sh`, puis relancer |
| L'API redémarre en boucle : « Configuration de production invalide » | `smtp_url` renseigné sans `APP_URL` en https, ou secret vide | Compléter `infra/docker/.env`, relancer |
| « Mot de passe oublié » n'envoie rien | `smtp_url` vide, identifiants faux, caractère spécial non encodé | Journaux de `api` dans Portainer, corriger `secrets/smtp_url`, `up -d` |
| E-mail reçu dans les indésirables | SPF, DKIM ou DMARC absent ou incorrect | Vérifier la zone DNS, attendre la propagation |
| `gest-finance.<réseau>.ts.net` injoignable | Appareil hors Tailscale, clé Tailscale expirée, HTTPS non activé | Connecter l'appareil ; nouvelle clé dans `secrets/ts_authkey` ; activer HTTPS Certificates |
| Portainer demande de redémarrer | Délai de 5 minutes pour créer l'administrateur dépassé | `docker restart portainer` |
| « aucune copie distante » dans `last-success.txt` | Stockage S3 non configuré ou clés invalides | Renseigner `secrets/rclone_conf` et `BACKUP_REMOTE` dans `infra/docker/.env` |
| Plus d'accès SSH | Pare-feu ou configuration SSH | Console KVM du manager OVH |
