#!/bin/sh
# Test de bout en bout : sauvegarde -> chiffrement -> restauration dans une base de test -> comparaison des lignes.
# Utilisable en local (PostgreSQL + age installés) et en CI. Variables : PGHOST PGUSER PGPASSWORD PGDATABASE.
set -eu
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
: "${PGDATABASE:?}"; : "${PGUSER:?}"; : "${PGHOST:?}"

age-keygen -o "$WORK/key.txt" 2> "$WORK/pub.txt"
RECIPIENT="$(sed -n 's/^Public key: //p' "$WORK/pub.txt")"
[ -n "$RECIPIENT" ] || RECIPIENT="$(age-keygen -y "$WORK/key.txt")"

echo "== 1. Sauvegarde chiffrée"
BACKUP_DIR="$WORK/backups" AGE_RECIPIENT="$RECIPIENT" "$SCRIPTS/backup.sh"
FILE="$(ls "$WORK"/backups/gest-*.dump.age)"
if grep -q "PGDMP" "$FILE"; then echo "ÉCHEC : le fichier contient un en-tête pg_dump en clair" >&2; exit 1; fi
echo "   fichier chiffré : $(basename "$FILE")"

echo "== 2. Restauration refusée sans la bonne clé"
age-keygen -o "$WORK/autre.txt" 2> /dev/null
TEST_DB="${PGDATABASE}_restore_test"
psql -d postgres -qc "DROP DATABASE IF EXISTS \"$TEST_DB\"" -c "CREATE DATABASE \"$TEST_DB\""
TARGET="postgresql://$PGUSER:${PGPASSWORD:-}@$PGHOST/$TEST_DB"
if "$SCRIPTS/restore.sh" "$FILE" "$WORK/autre.txt" "$TARGET" > /dev/null 2>&1; then echo "ÉCHEC : restauration possible avec une mauvaise clé" >&2; exit 1; fi

echo "== 3. Restauration refusée vers la production sans confirmation"
if "$SCRIPTS/restore.sh" "$FILE" "$WORK/key.txt" "postgresql://$PGUSER@$PGHOST/gest_finance" > /dev/null 2>&1; then echo "ÉCHEC : la restauration vers gest_finance n'a pas été bloquée" >&2; exit 1; fi

echo "== 4. Restauration avec la bonne clé dans $TEST_DB"
"$SCRIPTS/restore.sh" "$FILE" "$WORK/key.txt" "$TARGET"

echo "== 5. Comparaison des lignes avec la source"
for t in Household User BankAccount Transaction RecurringRule AuditLog; do
  a="$(psql -d "$PGDATABASE" -At -c "SELECT count(*) FROM \"$t\"")"
  b="$(psql -d "$TEST_DB" -At -c "SELECT count(*) FROM \"$t\"")"
  [ "$a" = "$b" ] || { echo "ÉCHEC : $t source=$a restaurée=$b" >&2; exit 1; }
done
psql -d postgres -qc "DROP DATABASE \"$TEST_DB\""
echo "OK : sauvegarde, chiffrement et restauration vérifiés."
