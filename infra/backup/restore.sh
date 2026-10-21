#!/bin/sh
# Restauration d'une sauvegarde chiffrée dans une base CIBLE EXPLICITE.
#   restore.sh <sauvegarde.dump.age> <fichier-cle-privee.txt> <url-base-cible>
# La clé privée (AGE-SECRET-KEY-...) est fournie au moment de la restauration seulement : ne la stockez jamais sur le serveur.
# Par sécurité, restaurer dans la base de production exige RESTORE_FORCE=yes.
set -eu

if [ "$#" -ne 3 ]; then
  echo "Usage : restore.sh <sauvegarde.dump.age> <cle-privee.txt> <url-base-cible>" >&2
  exit 2
fi
FILE="$1"; IDENTITY="$2"; TARGET="$3"
[ -r "$FILE" ] || { echo "Sauvegarde introuvable : $FILE" >&2; exit 2; }
[ -r "$IDENTITY" ] || { echo "Clé privée introuvable : $IDENTITY" >&2; exit 2; }

case "$TARGET" in
  *gest_finance|*gest_finance\?*)
    [ "${RESTORE_FORCE:-}" = "yes" ] || { echo "Refus : la cible ressemble à la base de production (gest_finance). Restaurez d'abord dans une base de test, ou exportez RESTORE_FORCE=yes en connaissance de cause." >&2; exit 3; } ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
age -d -i "$IDENTITY" -o "$TMP/dump" "$FILE" || { echo "Déchiffrement impossible : mauvaise clé privée ou fichier corrompu" >&2; exit 4; }
pg_restore --list "$TMP/dump" > /dev/null || { echo "Sauvegarde déchiffrée mais illisible" >&2; exit 4; }

echo "Restauration dans la base cible..."
pg_restore --no-owner --no-privileges --clean --if-exists --dbname "$TARGET" "$TMP/dump"

echo "Contrôle : nombre de lignes par table"
for t in Household User BankAccount Transaction RecurringRule AuditLog; do
  n="$(psql "$TARGET" -At -c "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo "?")"
  printf '  %-16s %s\n' "$t" "$n"
done
echo "Restauration terminée."
