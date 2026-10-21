#!/bin/sh
# Test de fumée de la pile démarrée : santé, en-têtes de sécurité, routage de toutes les routes de l'API,
# repli de l'application, parcours inscription -> compte -> résumé.
#   BASE=http://127.0.0.1:8080 sh infra/scripts/smoke.sh
#   SMOKE_DIRECT_API=1 BASE=http://127.0.0.1:3000 sh infra/scripts/smoke.sh   # API seule (sans proxy)
set -eu

BASE="${BASE:-http://127.0.0.1:8080}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
FAILED=0

ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1" >&2; FAILED=$((FAILED + 1)); }
check() { # description commande...
  desc="$1"; shift
  if "$@" > /dev/null 2>&1; then ok "$desc"; else fail "$desc"; fi
}

echo "Test de fumée sur $BASE"

echo "== Démarrage"
i=0
until curl -fsS -m 3 "$BASE/health" > /dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -ge 60 ] && { fail "l'application ne répond pas après 120 s"; exit 1; }
  sleep 2
done
ok "/health répond"

if [ "${SMOKE_DIRECT_API:-0}" != "1" ]; then
  echo "== En-têtes de sécurité et application"
  HEAD="$(curl -fsS -m 5 -D - -o /dev/null "$BASE/")"
  for h in "content-security-policy: default-src 'self'" "x-content-type-options: nosniff" "referrer-policy: no-referrer" "strict-transport-security"; do
    echo "$HEAD" | grep -qi "$h" && ok "en-tête $h" || fail "en-tête manquant : $h"
  done
  echo "$HEAD" | grep -qi '^server:' && fail "l'en-tête Server est exposé" || ok "pas d'en-tête Server"
  curl -fsS -m 5 "$BASE/" | grep -qi '<div id="root"' && ok "page d'accueil de l'application servie" || fail "page d'accueil absente"
  curl -fsS -m 5 "$BASE/une/page/inconnue" | grep -qi '<div id="root"' && ok "repli SPA sur une page inconnue" || fail "repli SPA absent"
  curl -fsS -m 5 -D - -o /dev/null "$BASE/sw.js" | grep -qi 'cache-control: no-cache' && ok "sw.js non mis en cache" || fail "sw.js peut rester en cache"
fi

echo "== Routage de chaque préfixe de l'API (jamais de page HTML)"
PREFIXES="$(grep -o '"/[a-z-]*"' "$ROOT/packages/shared/src/routes.ts" | tr -d '"' | sort -u)"
[ "$(echo "$PREFIXES" | wc -l)" -ge 10 ] || { fail "liste des préfixes illisible dans routes.ts"; exit 1; }
for p in $PREFIXES; do
  type="$(curl -s -m 5 -o /dev/null -w '%{content_type}' "$BASE$p")"
  case "$type" in application/json*) ok "$p -> JSON" ;; *) fail "$p renvoie « $type » (route non relayée vers l'API ?)" ;; esac
done

echo "== Parcours complet"
EMAIL="smoke-$(date +%s)@example.com"
code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -c "$JAR" -H 'Content-Type: application/json' -X POST "$BASE/auth/register" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"smoke-test-password-123\",\"displayName\":\"Test\",\"householdName\":\"Foyer test\"}")"
[ "$code" = "201" ] && ok "inscription (201)" || fail "inscription : code $code"
grep -qi 'HttpOnly' "$JAR" && ok "cookie de session HttpOnly" || fail "cookie sans HttpOnly"
ACCOUNT="$(curl -s -m 10 -b "$JAR" -H 'Content-Type: application/json' -X POST "$BASE/accounts" -d '{"name":"Courant","type":"CHECKING","initialBalanceCents":100000,"iban":"FR7630006000011234567890189"}')"
echo "$ACCOUNT" | grep -q '"ibanMasked":"FR76' && ok "compte créé, IBAN masqué" || fail "création de compte : $ACCOUNT"
echo "$ACCOUNT" | grep -q '1234567890' && fail "l'IBAN complet est exposé" || ok "IBAN complet jamais renvoyé"
curl -s -m 10 -b "$JAR" "$BASE/summary?from=2026-10-01&to=2026-10-31" | grep -q '"remainingCents"' && ok "reste à vivre calculé" || fail "résumé indisponible"
code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$BASE/accounts")"
[ "$code" = "401" ] && ok "accès sans session refusé (401)" || fail "accès sans session : code $code"

echo
if [ "$FAILED" -gt 0 ]; then echo "$FAILED vérification(s) en échec" >&2; exit 1; fi
echo "Toutes les vérifications ont réussi."
