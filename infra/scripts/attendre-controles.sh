#!/bin/sh
# Attend que tous les contrôles (check runs) d'un commit soient terminés et réussis, sauf celui qui attend.
#   sh infra/scripts/attendre-controles.sh <sha> <nom du contrôle à ignorer> [contrôle obligatoire...]
# Variables : GH_TOKEN, GITHUB_REPOSITORY. Délai maximal : ATTENTE_MAX secondes (défaut 3600).
# Code de sortie : 0 si tout est vert, 1 si un contrôle a échoué ou si le délai est dépassé.
# Un contrôle obligatoire absent fait attendre (les workflows démarrent parfois avec retard).
set -eu

SHA="$1"; SELF="$2"; shift 2
MAX="${ATTENTE_MAX:-3600}"
START="$(date +%s)"
stable=0

while :; do
  runs="$(gh api --paginate "repos/$GITHUB_REPOSITORY/commits/$SHA/check-runs?per_page=100" \
    --jq ".check_runs[] | select(.name != \"$SELF\") | \"\(.name)\t\(.status)\t\(.conclusion)\"")"
  missing=""
  for required in "$@"; do
    printf '%s\n' "$runs" | cut -f1 | grep -qx "$required" || missing="$missing $required"
  done
  failed="$(printf '%s\n' "$runs" | awk -F'\t' '$2 == "completed" && $3 != "success" && $3 != "skipped" && $3 != "neutral" { print $1 " (" $3 ")" }')"
  pending="$(printf '%s\n' "$runs" | awk -F'\t' 'NF && $2 != "completed" { print $1 }')"
  if [ -n "$failed" ]; then
    echo "Contrôle(s) en échec : $failed"
    exit 1
  fi
  if [ -z "$missing" ] && [ -z "$pending" ] && [ -n "$runs" ]; then
    # Deux constats « tout vert » à une minute d'intervalle : un workflow lancé en retard est pris en compte.
    stable=$((stable + 1))
    [ "$stable" -ge 2 ] && { echo "Tous les contrôles sont verts :"; printf '%s\n' "$runs" | cut -f1 | sed 's/^/  - /'; exit 0; }
  else
    stable=0
  fi
  if [ $(( $(date +%s) - START )) -ge "$MAX" ]; then
    echo "Délai dépassé. En attente :${missing:+ absents$missing}${pending:+ ; en cours $(echo $pending)}"
    exit 1
  fi
  sleep 60
done
