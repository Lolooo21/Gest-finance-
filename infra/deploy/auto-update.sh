#!/bin/sh
# Mise à jour automatique du VPS vers la dernière version publiée (tag v*), avec sauvegarde, contrôle et retour arrière.
# Lancée chaque nuit par le minuteur systemd installé par infra/deploy/install-auto-update.sh ; à la main :
#   sh infra/deploy/auto-update.sh
#
# Étapes : dernière version du même numéro majeur → signature des images vérifiée (cosign, identité du workflow de publication)
# → sauvegarde chiffrée + copie locale temporaire de la base → bascule (fichiers du tag, images, migrations) → contrôle de santé
# → succès (anciennes images de l'application supprimées, la précédente gardée pour un retour arrière manuel), ou retour à la
# version précédente (et à la base d'avant si une migration a été appliquée) → notification.
#
# Réglages (fichier infra/deploy/auto-update.env, facultatif) :
#   NOTIFY_URL       adresse qui reçoit le compte rendu en POST (ex. https://ntfy.sh/<sujet-secret>) ; vide = journal seulement
#   AUTO_MAJOR=1     accepter aussi un changement de version majeure (par défaut : notification seulement)
# Réservé aux tests (CI) : AUTO_UPDATE_TARGET (version imposée), AUTO_UPDATE_SKIP_GIT=1, AUTO_UPDATE_SKIP_VERIFY=1,
#   AUTO_UPDATE_SKIP_PULL=1, AUTO_UPDATE_FORCE_RESTORE=1, COMPOSE (commande docker compose complète).
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
[ -f infra/deploy/auto-update.env ] && . ./infra/deploy/auto-update.env
ENV_FILE="infra/docker/.env"
COMPOSE="${COMPOSE:-docker compose -f infra/docker/compose.prod.yml --profile prod}"
REPO="Lolooo21/Gest-finance-"
IMAGES="api proxy backup"
COSIGN_IMAGE="ghcr.io/sigstore/cosign/cosign:v2.4.1"
STATE="${AUTO_UPDATE_STATE:-$ROOT/.auto-update}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
notify() { # titre message
  log "$1 : $2"
  [ -n "${NOTIFY_URL:-}" ] || return 0
  curl -fsS -m 15 -H "Title: Gest-finance : $1" -d "$2" "$NOTIFY_URL" > /dev/null 2>&1 || log "notification non envoyée"
}
current_version() { sed -n 's/^GEST_VERSION=//p' "$ENV_FILE" | tail -n1; }
set_version() { # version
  if grep -q '^GEST_VERSION=' "$ENV_FILE"; then sed -i "s/^GEST_VERSION=.*/GEST_VERSION=$1/" "$ENV_FILE"; else echo "GEST_VERSION=$1" >> "$ENV_FILE"; fi
}
migrations() { $COMPOSE exec -T postgres psql -U gest -d gest_finance -tAc 'SELECT count(*) FROM _prisma_migrations' 2>/dev/null | tr -d '[:space:]'; }

# Un seul passage à la fois.
mkdir -p "$STATE" && chmod 700 "$STATE"
if ! mkdir "$STATE/verrou" 2>/dev/null; then log "Une mise à jour est déjà en cours."; exit 0; fi
trap 'rmdir "$STATE/verrou" 2>/dev/null || true' EXIT

CURRENT="$(current_version)"
if [ -z "$CURRENT" ] || [ "$CURRENT" = "local" ]; then
  log "GEST_VERSION=${CURRENT:-?} : images construites sur place, pas de mise à jour automatique (voir docs/deploiement.md)."
  exit 0
fi

# 1. Version cible : le plus récent tag v* du même numéro majeur.
if [ -n "${AUTO_UPDATE_TARGET:-}" ]; then
  TARGET="$AUTO_UPDATE_TARGET"
else
  git fetch --quiet --tags origin
  LATEST="$(git tag --list 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n1)"
  TARGET="${LATEST#v}"
fi
[ -n "$TARGET" ] || { log "Aucune version publiée."; exit 0; }
if [ "$TARGET" = "$CURRENT" ]; then log "Déjà à jour ($CURRENT)."; exit 0; fi
if [ "$(printf '%s\n%s\n' "$CURRENT" "$TARGET" | sort -V | tail -n1)" = "$CURRENT" ]; then log "La version installée ($CURRENT) est plus récente que $TARGET : rien à faire."; exit 0; fi
if [ "${CURRENT%%.*}" != "${TARGET%%.*}" ] && [ "${AUTO_MAJOR:-0}" != "1" ]; then
  notify "nouvelle version majeure" "La version $TARGET est disponible (installée : $CURRENT). Changement majeur : à installer à la main (docs/deploiement.md)."
  exit 0
fi
log "Mise à jour $CURRENT → $TARGET"

# 2. Signature des images : publiées par le workflow release.yml de ce dépôt, sur un tag v*.
if [ "${AUTO_UPDATE_SKIP_VERIFY:-0}" != "1" ]; then
  for name in $IMAGES; do
    if ! docker run --rm -e DOCKER_CONFIG=/dockercfg -v "${HOME:-/root}/.docker:/dockercfg:ro" "$COSIGN_IMAGE" verify \
        --certificate-oidc-issuer https://token.actions.githubusercontent.com \
        --certificate-identity-regexp "^https://github.com/$REPO/.github/workflows/release.yml@refs/tags/v" \
        "ghcr.io/lolooo21/gest-finance-$name:$TARGET" > /dev/null 2>&1; then
      notify "mise à jour refusée" "Signature invalide ou absente pour l'image $name:$TARGET. Rien n'a été modifié."
      exit 1
    fi
  done
  log "Signatures des images vérifiées."
fi

# 3. Fichiers du tag (compose, scripts) : seulement si le dépôt n'a pas de modification locale.
if [ "${AUTO_UPDATE_SKIP_GIT:-0}" != "1" ]; then
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    notify "mise à jour refusée" "Le dépôt du serveur a des modifications locales (git status) : mise à jour $TARGET à faire à la main."
    exit 1
  fi
  PREVIOUS_REF="$(git rev-parse HEAD)"
fi

# 4. Images de la cible téléchargées AVANT tout arrêt (une coupure réseau ne laisse pas l'application à moitié installée).
if [ "${AUTO_UPDATE_SKIP_PULL:-0}" != "1" ]; then
  for name in $IMAGES; do docker pull -q "ghcr.io/lolooo21/gest-finance-$name:$TARGET" > /dev/null; done
fi

# 5. Sauvegardes : chiffrée (copie distante habituelle) et copie locale temporaire pour un retour arrière immédiat
#    (la clé privée des sauvegardes n'est jamais sur le serveur).
if ! $COMPOSE exec -T backup backup.sh > "$STATE/sauvegarde.log" 2>&1; then
  notify "mise à jour annulée" "La sauvegarde d'avant mise à jour a échoué ($TARGET non installée). Détail : $STATE/sauvegarde.log"
  exit 1
fi
DUMP="$STATE/avant-$TARGET.dump"
( umask 077; $COMPOSE exec -T postgres pg_dump -U gest -d gest_finance -Fc > "$DUMP" )
BEFORE_MIGRATIONS="$(migrations)"
log "Sauvegardes faites ($BEFORE_MIGRATIONS migrations appliquées)."

healthy() { # vrai si migrate a réussi et si api et proxy sont « healthy »
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    m="$($COMPOSE ps -a --format '{{.Service}} {{.State}} {{.ExitCode}} {{.Health}}' 2>/dev/null)"
    if printf '%s\n' "$m" | grep -Eq '^migrate exited [1-9]'; then return 1; fi
    if printf '%s\n' "$m" | grep -Eq '^api running 0 healthy' && printf '%s\n' "$m" | grep -Eq '^proxy running 0 healthy'; then
      $COMPOSE exec -T api node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && return 0
    fi
    sleep 5
  done
  return 1
}

deploy() { # version
  set_version "$1"
  $COMPOSE up -d --remove-orphans > "$STATE/deploiement.log" 2>&1 || return 1
  healthy
}

# 6. Bascule.
[ "${AUTO_UPDATE_SKIP_GIT:-0}" = "1" ] || git -c advice.detachedHead=false checkout -q "v$TARGET"
# Supprime les images de l'application des versions ANTÉRIEURES à la précédente : le disque ne se remplit pas au fil des versions,
# la version installée et la précédente (retour arrière manuel) restent, une version plus récente déjà téléchargée aussi.
# Seuls les tags de version (X.Y.Z) sont concernés ; les images tierces (PostgreSQL, Tailscale) ne sont pas touchées.
prune_images() { # version précédente
  for name in $IMAGES; do
    docker image ls "ghcr.io/lolooo21/gest-finance-$name" --format '{{.Tag}}' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | while read -r tag; do
      if [ "$tag" != "$1" ] && [ "$(printf '%s\n%s\n' "$tag" "$1" | sort -V | head -n1)" = "$tag" ]; then
        docker image rm "ghcr.io/lolooo21/gest-finance-$name:$tag" > /dev/null 2>&1 || true
      fi
    done
  done
  docker image prune -f > /dev/null 2>&1 || true
}

if deploy "$TARGET"; then
  rm -f "$DUMP"
  prune_images "$CURRENT"
  notify "version $TARGET installée" "Mise à jour $CURRENT → $TARGET réussie (sauvegarde faite avant, contrôle de santé vert)."
  exit 0
fi

# 7. Retour arrière : version précédente, et base d'avant si une migration a été appliquée entre-temps.
log "Échec du contrôle de santé de $TARGET : retour à $CURRENT."
$COMPOSE logs --no-color --tail=80 > "$STATE/echec-$TARGET.log" 2>&1 || true
[ "${AUTO_UPDATE_SKIP_GIT:-0}" = "1" ] || git -c advice.detachedHead=false checkout -q "$PREVIOUS_REF"
AFTER_MIGRATIONS="$(migrations || true)"
RESTORED="non"
if [ "${AUTO_UPDATE_FORCE_RESTORE:-0}" = "1" ] || [ "$AFTER_MIGRATIONS" != "$BEFORE_MIGRATIONS" ]; then
  $COMPOSE stop proxy api > /dev/null 2>&1 || true
  $COMPOSE exec -T postgres pg_restore -U gest -d gest_finance --clean --if-exists --single-transaction < "$DUMP"
  RESTORED="oui"
fi
if deploy "$CURRENT"; then
  notify "mise à jour $TARGET annulée" "La version $TARGET a échoué au contrôle de santé : retour à $CURRENT réussi (base restaurée : $RESTORED). Journaux : $STATE/echec-$TARGET.log"
  exit 1
fi
notify "URGENT : application arrêtée" "La version $TARGET a échoué ET le retour à $CURRENT aussi. Copie de la base d'avant : $DUMP. Journaux : $STATE/. Voir docs/deploiement.md (Restaurer)."
exit 2
