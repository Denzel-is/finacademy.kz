set -eu
database=finacademy_audit_check
unit=finance-academy-security-check
release=/opt/finance-academy/releases/20261016-4
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='finacademy_audit_check'" | grep -q 1; then
  echo 'Disposable database already exists; refusing to overwrite.' >&2
  exit 1
fi
cleanup() {
  systemctl stop "$unit" 2>/dev/null || true
  sudo -u postgres dropdb --if-exists "$database"
}
sudo -u postgres createdb -O finacademy "$database"
trap cleanup EXIT INT TERM
sudo -u finacademy psql -v ON_ERROR_STOP=1 -d "$database" -f /var/lib/finance-academy/policy-schema.sql >/dev/null
sudo -u finacademy psql -v ON_ERROR_STOP=1 -d "$database" -f "$release/migrations/0003_flows.sql" >/dev/null
sudo -u finacademy psql -v ON_ERROR_STOP=1 -d "$database" -f "$release/migrations/0004_attempt_flow.sql" >/dev/null
systemd-run --quiet --unit="$unit" --property=User=finacademy --property=WorkingDirectory="$release" --setenv=PGDATABASE="$database" --setenv=PORT=3001 --setenv=PUBLIC_ORIGIN=http://127.0.0.1:3001 /usr/bin/node "$release/build/server.mjs"
for i in 1 2 3 4 5; do
  if curl --fail --silent http://127.0.0.1:3001/api/ready >/dev/null; then break; fi
  sleep 1
done
sudo -u finacademy env PGDATABASE="$database" node "$release/scripts/deploy/verify-audit.mjs"
sudo -u finacademy env PGDATABASE="$database" node "$release/scripts/deploy/verify-security.mjs"
