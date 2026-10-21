#!/bin/sh
# Lance backup.sh chaque jour à BACKUP_TIME (UTC, « HH:MM »). Sans cron, donc sans privilèges.
set -eu
BACKUP_TIME="${BACKUP_TIME:-03:30}"
echo "Planificateur de sauvegarde : tous les jours à ${BACKUP_TIME} UTC"
while true; do
  now="$(date -u +%s)"
  target="$(date -u -d "$(date -u +%Y-%m-%d) ${BACKUP_TIME}:00" +%s)"
  [ "$target" -le "$now" ] && target=$((target + 86400))
  sleep $((target - now))
  backup.sh || echo "ERREUR : la sauvegarde a échoué (code $?)"
done
