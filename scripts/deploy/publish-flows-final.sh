set -eu
release=/opt/finance-academy/releases/20261016-2
test "$(readlink -f /opt/finance-academy/current)" = "$release"
/usr/local/sbin/finance-academy-backup
tar -xzf /root/finance-academy-flows-final.tar.gz -C "$release"
chown -R finacademy:finacademy "$release"
cp -a "$release/dist/." /var/www/finance-academy/
find /var/www/finance-academy -type d -exec chmod 755 {} +
find /var/www/finance-academy -type f -exec chmod 644 {} +
systemctl restart finance-academy
sleep 1
curl --fail --silent --show-error https://finacademy.kz/api/health
