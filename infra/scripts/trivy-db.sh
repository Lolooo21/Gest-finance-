#!/bin/sh
# Télécharge la base de failles de Trivy une seule fois, avec retentatives, dans un cache partagé par les analyses suivantes
# (lancées ensuite avec TRIVY_SKIP_DB_UPDATE=true). Le miroir par défaut (mirror.gcr.io) répond parfois « 429 Too Many
# Requests » : un essai sur deux passe par la source d'origine (ghcr.io), avec une attente croissante entre les essais.
# Usage : sh infra/scripts/trivy-db.sh aquasec/trivy:0.58.1   (cache : $TRIVY_CACHE, par défaut ~/.cache/trivy)
set -eu

image="${1:?image Trivy attendue, par exemple aquasec/trivy:0.58.1}"
cache="${TRIVY_CACHE:-$HOME/.cache/trivy}"
attempts="${TRIVY_DB_ATTEMPTS:-5}"
mkdir -p "$cache"

i=1
while :; do
  if [ $((i % 2)) -eq 1 ]; then repo=""; else repo="--db-repository ghcr.io/aquasecurity/trivy-db:2"; fi
  echo "Base de failles Trivy : essai $i/$attempts${repo:+ (ghcr.io)}"
  # shellcheck disable=SC2086 # $repo : option et valeur volontairement découpées
  if docker run --rm -v "$cache:/root/.cache/trivy" "$image" image --download-db-only --quiet $repo; then
    echo "Base de failles Trivy prête."
    exit 0
  fi
  if [ "$i" -ge "$attempts" ]; then
    echo "Échec : base de failles Trivy indisponible après $attempts essais." >&2
    exit 1
  fi
  sleep $((i * 15))
  i=$((i + 1))
done
