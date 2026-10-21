#!/bin/sh
# Crée les secrets de production dans ./secrets (droits 600) et infra/docker/.env.
#   sh infra/scripts/init-secrets.sh          interactif (clé publique age, clé Tailscale, stockage S3)
#   sh infra/scripts/init-secrets.sh --local  non interactif, pour ESSAYER la pile sur votre PC sans VPS (valeurs factices ;
#                                             la clé privée de test est conservée dans secrets/age_identity_test.txt)
#   sh infra/scripts/init-secrets.sh --ci     identique, pour la CI
# Un secret existant n'est JAMAIS régénéré (changer le mot de passe de la base casserait l'accès aux données) :
# supprimez le fichier volontairement pour le renouveler.
set -eu
umask 077

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="${SECRETS_DIR:-$ROOT/secrets}"
ENV_FILE="${ENV_FILE:-$ROOT/infra/docker/.env}"
CI=0
{ [ "${1:-}" = "--ci" ] || [ "${1:-}" = "--local" ]; } && CI=1

mkdir -p "$DIR"
chmod 700 "$DIR"

say() { printf '%s\n' "$*"; }
exists() { [ -s "$DIR/$1" ] || { [ -f "$DIR/$1" ] && [ "$2" = "allow-empty" ]; }; }

write() { # nom valeur
  if exists "$1" strict; then say "  = $1 existe déjà : conservé"; return 0; fi
  printf '%s' "$2" > "$DIR/$1"
  chmod 600 "$DIR/$1"
  say "  + $1 créé"
}

ask() { # invite -> réponse (vide en mode CI)
  [ "$CI" = "1" ] && { printf ''; return 0; }
  printf '%s' "$1" >&2
  read -r answer
  printf '%s' "$answer"
}

say "Secrets de production : $DIR"

# --- Générés automatiquement (aléatoires, forts) ---
PG_PASSWORD="$(openssl rand -hex 24)"
write postgres_password "$PG_PASSWORD"
# Si le mot de passe existait déjà, le reprendre pour construire l'URL.
PG_PASSWORD="$(cat "$DIR/postgres_password")"
write database_url "postgresql://gest:${PG_PASSWORD}@postgres:5432/gest_finance"
write jwt_secret "$(openssl rand -base64 48 | tr -d '\n')"
write field_encryption_key "$(openssl rand -base64 32 | tr -d '\n')"

# --- Clé publique age (sauvegardes) : la clé privée reste sur VOTRE ordinateur ---
if ! exists age_recipient strict; then
  if [ "$CI" = "1" ]; then
    command -v age-keygen > /dev/null || { say "age-keygen est requis pour les modes --local et --ci (Windows : winget install FiloSottile.age)" >&2; exit 1; }
    tmpdir="$(mktemp -d)"; age-keygen -o "$tmpdir/key.txt" 2> /dev/null; RECIPIENT="$(age-keygen -y "$tmpdir/key.txt")"
    # Clé de TEST uniquement : permet d'essayer une restauration en local. En production, la clé privée ne doit jamais être sur le serveur.
    cp "$tmpdir/key.txt" "$DIR/age_identity_test.txt"; chmod 600 "$DIR/age_identity_test.txt"; rm -rf "$tmpdir"
  else
    say ""
    say "Clé de chiffrement des sauvegardes : sur VOTRE ordinateur, lancez « age-keygen -o cle-sauvegarde.txt » ;"
    say "gardez ce fichier (clé PRIVÉE) en lieu sûr hors du serveur, et collez ici la clé PUBLIQUE (age1...)."
    RECIPIENT="$(ask 'Clé publique age : ')"
    case "$RECIPIENT" in age1*) ;; *) say "Clé publique invalide (doit commencer par age1)." >&2; exit 1 ;; esac
  fi
  write age_recipient "$RECIPIENT"
else
  say "  = age_recipient existe déjà : conservé"
fi

# --- Tailscale ---
if ! exists ts_authkey strict; then
  if [ "$CI" = "1" ]; then KEY="tskey-auth-ci-factice"; else
    say ""
    say "Clé d'authentification Tailscale : https://login.tailscale.com/admin/settings/keys -> « Generate auth key » (non réutilisable conseillé)."
    KEY="$(ask 'Clé Tailscale (tskey-auth-...) : ')"
    [ -n "$KEY" ] || { say "Clé Tailscale obligatoire." >&2; exit 1; }
  fi
  write ts_authkey "$KEY"
else
  say "  = ts_authkey existe déjà : conservé"
fi

# --- Stockage distant des sauvegardes (S3 compatible) ---
REMOTE=""
if ! exists rclone_conf allow-empty; then
  ANSWER="$(ask 'Configurer maintenant le stockage S3 des sauvegardes ? (o/N) : ')"
  case "$ANSWER" in
    o|O|oui|OUI)
      ENDPOINT="$(ask 'Endpoint S3 (ex. https://s3.fr-par.scw.cloud) : ')"
      REGION="$(ask 'Région (ex. fr-par) : ')"
      BUCKET="$(ask 'Nom du bucket : ')"
      AK="$(ask 'Access key : ')"
      SK="$(ask 'Secret key : ')"
      printf '[sauvegardes]\ntype = s3\nprovider = Other\nendpoint = %s\nregion = %s\naccess_key_id = %s\nsecret_access_key = %s\n' "$ENDPOINT" "$REGION" "$AK" "$SK" > "$DIR/rclone_conf"
      chmod 600 "$DIR/rclone_conf"
      REMOTE="sauvegardes:${BUCKET}/gest-finance"
      say "  + rclone_conf créé"
      ;;
    *)
      printf '# Stockage distant non configuré : les sauvegardes restent sur le serveur (déconseillé).\n' > "$DIR/rclone_conf"
      chmod 600 "$DIR/rclone_conf"
      say "  + rclone_conf vide créé (à renseigner plus tard)"
      ;;
  esac
fi

# --- infra/docker/.env (valeurs non secrètes) ---
if [ ! -f "$ENV_FILE" ]; then
  printf 'GEST_VERSION=local\nBACKUP_REMOTE=%s\n' "$REMOTE" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  say "  + $(basename "$ENV_FILE") créé"
fi

say ""
say "Terminé. Ne versionnez jamais ce dossier (déjà ignoré par Git) et sauvegardez-le séparément."
