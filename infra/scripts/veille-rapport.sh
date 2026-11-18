#!/bin/sh
# Rapport de veille de sécurité : transforme les résultats JSON de Trivy en tableau Markdown.
#   sh infra/scripts/veille-rapport.sh rapport.md resultat1.json resultat2.json ...
# Chaque fichier JSON est la sortie de `trivy ... --format json` ; son nom (sans .json) sert de titre.
# Code de sortie : 0 si aucune faille haute ou critique corrigeable, 1 sinon (le rapport est écrit dans les deux cas).
set -eu

OUT="$1"; shift
TOTAL=0
{
  echo "_Analyse du $(date -u '+%Y-%m-%d %H:%M') UTC : failles de gravité haute ou critique pour lesquelles un correctif existe._"
  echo
  for f in "$@"; do
    name="$(basename "$f" .json)"
    rows="$(jq -r '[.Results[]? | .Target as $t | .Vulnerabilities[]?
        | select(.FixedVersion != null and .FixedVersion != "")
        | "| \(.Severity) | [\(.VulnerabilityID)](https://avd.aquasec.com/nvd/\(.VulnerabilityID | ascii_downcase)) | \(.PkgName) | \(.InstalledVersion) | \(.FixedVersion) | \($t) |"]
      | unique | .[]' "$f")"
    count="$(printf '%s' "$rows" | grep -c '^|' || true)"
    TOTAL=$((TOTAL + count))
    if [ "$count" -eq 0 ]; then
      echo "### ✅ $name : rien à corriger"
    else
      echo "### ⚠️ $name : $count faille(s)"
      echo
      echo "| Gravité | Faille | Paquet | Version installée | Corrigée en | Où |"
      echo "|---|---|---|---|---|---|"
      printf '%s\n' "$rows"
    fi
    echo
  done
} > "$OUT"
echo "$TOTAL faille(s) haute(s) ou critique(s) corrigeable(s)."
[ "$TOTAL" -eq 0 ]
