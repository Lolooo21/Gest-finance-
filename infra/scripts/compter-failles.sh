#!/bin/sh
# Nombre de failles hautes ou critiques CORRIGEABLES dans des résultats JSON de Trivy (paires faille + paquet, sans doublon).
#   sh infra/scripts/compter-failles.sh resultat1.json [resultat2.json...]
set -eu
jq -s '[.[] | .Results[]? | .Vulnerabilities[]? | select(.FixedVersion != null and .FixedVersion != "") | "\(.VulnerabilityID) \(.PkgName)"] | unique | length' "$@"
