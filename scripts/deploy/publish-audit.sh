set -eu
release=/opt/finance-academy/releases/20261016-3
previous=/opt/finance-academy/releases/20261016-2
test "$(readlink -f /opt/finance-academy/current)" = "$previous"
test -f "$release/build/server.mjs"
test "$(sudo -u finacademy psql -d finacademy -tAc "SELECT count(*) FROM attempts WHERE status='active'")" = 0
/usr/local/sbin/finance-academy-backup
sudo -u finacademy node "$release/scripts/deploy/snapshot-audit.mjs" before
sudo -u finacademy psql -d finacademy -v ON_ERROR_STOP=1 --single-transaction -f "$release/migrations/0004_attempt_flow.sql" -c "INSERT INTO app_migrations(name) VALUES('0004_attempt_flow');"
rollback() {
  ln -sfn "$previous" /opt/finance-academy/current
  cp -a "$previous/dist/." /var/www/finance-academy/
  find /var/www/finance-academy -type d -exec chmod 755 {} +
  find /var/www/finance-academy -type f -exec chmod 644 {} +
  systemctl restart finance-academy
  echo 'Release rolled back; additive migration retained.' >&2
}
trap rollback EXIT
ln -sfn "$release" /opt/finance-academy/current
cp -a "$release/dist/." /var/www/finance-academy/
find /var/www/finance-academy -type d -exec chmod 755 {} +
find /var/www/finance-academy -type f -exec chmod 644 {} +
systemctl restart finance-academy
for i in 1 2 3 4 5; do
  if curl --fail --silent https://finacademy.kz/api/health >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent --dump-header /var/lib/finance-academy/audit-health.headers https://finacademy.kz/api/health
grep -iq '^x-app-revision: audit-20261016-3' /var/lib/finance-academy/audit-health.headers
sudo -u finacademy node "$release/scripts/deploy/snapshot-audit.mjs" after
trap - EXIT
