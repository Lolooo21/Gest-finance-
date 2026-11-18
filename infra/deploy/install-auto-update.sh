#!/bin/sh
# Installe (ou retire) la mise à jour automatique nocturne sur le VPS : un service systemd « oneshot » et son minuteur.
#   sudo sh infra/deploy/install-auto-update.sh            # installer (chaque nuit à 04:30, heure du serveur)
#   sudo sh infra/deploy/install-auto-update.sh --retirer  # désinstaller
# Le service tourne sous l'utilisateur propriétaire du dépôt (membre du groupe docker), jamais en root.
set -eu

[ "$(id -u)" -eq 0 ] || { echo "À lancer avec sudo."; exit 1; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UNIT=/etc/systemd/system/gest-finance-maj

if [ "${1:-}" = "--retirer" ]; then
  systemctl disable --now gest-finance-maj.timer 2>/dev/null || true
  rm -f "$UNIT.service" "$UNIT.timer"
  systemctl daemon-reload
  echo "Mise à jour automatique retirée."
  exit 0
fi

OWNER="$(stat -c '%U' "$ROOT")"
id -nG "$OWNER" | tr ' ' '\n' | grep -qx docker || { echo "L'utilisateur $OWNER doit être dans le groupe docker (sudo usermod -aG docker $OWNER)."; exit 1; }

cat > "$UNIT.service" <<EOF
[Unit]
Description=Gest-finance : mise à jour automatique vers la dernière version signée
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$OWNER
WorkingDirectory=$ROOT
ExecStart=/bin/sh $ROOT/infra/deploy/auto-update.sh
TimeoutStartSec=45min
NoNewPrivileges=true
PrivateTmp=true
EOF

cat > "$UNIT.timer" <<'EOF'
[Unit]
Description=Gest-finance : mise à jour automatique chaque nuit (après la sauvegarde de 03:30 UTC)

[Timer]
OnCalendar=*-*-* 04:30:00
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now gest-finance-maj.timer
echo "Mise à jour automatique installée pour $OWNER dans $ROOT."
systemctl list-timers gest-finance-maj.timer --no-pager
echo "Journal : journalctl -u gest-finance-maj.service    Lancer tout de suite : sudo systemctl start gest-finance-maj.service"
