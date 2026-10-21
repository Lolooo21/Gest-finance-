#!/bin/sh
# Sauvegarde chiffrée de la base PostgreSQL.
#   pg_dump (format custom) -> contrôle -> chiffrement age (clé PUBLIQUE) -> /backups -> envoi distant (rclone) -> rétention
# La clé privée n'existe jamais sur le serveur : sans elle, une sauvegarde volée est illisible.
set -eu

: "${PGHOST:?PGHOST manquant}" "${PGUSER:?PGUSER manquant}" "${PGDATABASE:?PGDATABASE manquant}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_LOCAL="${KEEP_LOCAL:-7}"          # sauvegardes conservées sur le serveur
KEEP_REMOTE_DAYS="${KEEP_REMOTE_DAYS:-35}"   # jours conservés à distance (quotidiennes)
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"     # sauvegardes mensuelles conservées à distance
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

# Secrets : fichiers (secrets Docker) ou variables.
if [ -z "${PGPASSWORD:-}" ] && [ -n "${PGPASSWORD_FILE:-}" ]; then PGPASSWORD="$(cat "$PGPASSWORD_FILE")"; export PGPASSWORD; fi
if [ -z "${AGE_RECIPIENT:-}" ] && [ -n "${AGE_RECIPIENT_FILE:-}" ]; then AGE_RECIPIENT="$(cat "$AGE_RECIPIENT_FILE")"; fi
: "${AGE_RECIPIENT:?clé publique age manquante (AGE_RECIPIENT ou AGE_RECIPIENT_FILE)}"
case "$AGE_RECIPIENT" in
  age1*) ;;
  AGE-SECRET-KEY*) log "ERREUR : c'est une clé PRIVÉE age. N'enregistrez ici que la clé publique (age1...)."; exit 2 ;;
  *) log "ERREUR : clé publique age invalide (elle doit commencer par age1)"; exit 2 ;;
esac

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u '+%Y%m%d-%H%M%S')"
NAME="gest-${STAMP}.dump.age"

log "Sauvegarde de ${PGDATABASE} sur ${PGHOST}..."
pg_dump --format=custom --no-owner --no-privileges "$PGDATABASE" > "$TMP/dump"
[ -s "$TMP/dump" ] || { log "ERREUR : sauvegarde vide"; exit 1; }
pg_restore --list "$TMP/dump" > /dev/null || { log "ERREUR : sauvegarde illisible"; exit 1; }

age -r "$AGE_RECIPIENT" -o "$TMP/$NAME" "$TMP/dump"
[ -s "$TMP/$NAME" ] || { log "ERREUR : chiffrement échoué"; exit 1; }
mv "$TMP/$NAME" "$BACKUP_DIR/$NAME"
SIZE="$(wc -c < "$BACKUP_DIR/$NAME" | tr -d ' ')"
log "Sauvegarde chiffrée créée : $NAME ($SIZE octets)"

REMOTE_STATUS="aucune copie distante"
if [ -n "${BACKUP_REMOTE:-}" ] && [ -r "${RCLONE_CONFIG:-/nonexistent}" ] && grep -q '^\[' "$RCLONE_CONFIG" 2>/dev/null; then
  if rclone copyto "$BACKUP_DIR/$NAME" "$BACKUP_REMOTE/daily/$NAME" --quiet; then
    # Copie mensuelle (1er du mois) conservée plus longtemps.
    if [ "$(date -u +%d)" = "01" ]; then rclone copyto "$BACKUP_DIR/$NAME" "$BACKUP_REMOTE/monthly/$NAME" --quiet || true; fi
    rclone delete "$BACKUP_REMOTE/daily" --min-age "${KEEP_REMOTE_DAYS}d" --quiet || true
    rclone lsf "$BACKUP_REMOTE/monthly" --quiet 2>/dev/null | sort | head -n "-${KEEP_MONTHLY}" | while read -r old; do rclone deletefile "$BACKUP_REMOTE/monthly/$old" --quiet || true; done
    REMOTE_STATUS="copie distante OK"
    log "Copie distante envoyée"
  else
    REMOTE_STATUS="ÉCHEC de la copie distante"
    log "ATTENTION : l'envoi distant a échoué ; la sauvegarde reste uniquement sur le serveur"
  fi
else
  log "ATTENTION : aucun stockage distant configuré (BACKUP_REMOTE / rclone.conf) : la sauvegarde ne survivrait pas à la perte du serveur"
fi

# Rétention locale : on garde les plus récentes.
ls -1t "$BACKUP_DIR"/gest-*.dump.age 2>/dev/null | tail -n "+$((KEEP_LOCAL + 1))" | while read -r old; do rm -f "$old"; done

printf '%s\n%s\n%s octets\n%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$NAME" "$SIZE" "$REMOTE_STATUS" > "$BACKUP_DIR/last-success.txt"
case "$REMOTE_STATUS" in ÉCHEC*) exit 3 ;; esac
