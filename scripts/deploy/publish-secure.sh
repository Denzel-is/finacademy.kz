set -eu
release=/opt/finance-academy/releases/20261016-4
previous=/opt/finance-academy/releases/20261016-3
test "$(readlink -f /opt/finance-academy/current)" = "$previous"
test "$(sudo -u finacademy psql -d finacademy -tAc "SELECT count(*) FROM attempts WHERE status='active'")" = 0
/usr/local/sbin/finance-academy-backup
sudo -u finacademy node "$release/scripts/deploy/snapshot-audit.mjs" before
rollback() {
  ln -sfn "$previous" /opt/finance-academy/current
  cp -a "$previous/dist/." /var/www/finance-academy/
  find /var/www/finance-academy -type d -exec chmod 755 {} +
  find /var/www/finance-academy -type f -exec chmod 644 {} +
  systemctl restart finance-academy
  echo 'Application rolled back. Database was not restored over live data.' >&2
}
trap rollback EXIT
ln -sfn "$release" /opt/finance-academy/current
cp -a "$release/dist/." /var/www/finance-academy/
find /var/www/finance-academy -type d -exec chmod 755 {} +
find /var/www/finance-academy -type f -exec chmod 644 {} +
systemctl restart finance-academy
for i in 1 2 3 4 5; do
  if curl --fail --silent http://127.0.0.1:3000/api/ready >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:3000/api/ready
curl --fail --silent --dump-header /var/lib/finance-academy/security-health.headers https://finacademy.kz/api/health
grep -iq '^x-app-revision: secure-20261016-4' /var/lib/finance-academy/security-health.headers
sudo -u finacademy node "$release/scripts/deploy/snapshot-audit.mjs" after
trap - EXIT
