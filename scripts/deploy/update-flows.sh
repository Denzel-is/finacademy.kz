set -eu
release=/opt/finance-academy/releases/20261016-2
/usr/local/sbin/finance-academy-backup
install -d -o finacademy -g finacademy -m 750 "$release"
tar -xzf /root/finance-academy-flows.tar.gz -C "$release"
chown -R finacademy:finacademy "$release"
cd "$release"
sudo -u finacademy npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/var/log/finance-academy-install-flows.log 2>&1
sudo -u finacademy psql -v ON_ERROR_STOP=1 -d finacademy -c 'CREATE TABLE IF NOT EXISTS app_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());'
if ! sudo -u finacademy psql -tAc "SELECT 1 FROM app_migrations WHERE name='0003_flows'" -d finacademy | grep -q 1; then
  { printf 'BEGIN;\n'; cat migrations/0003_flows.sql; printf "\nINSERT INTO app_migrations(name) VALUES('0003_flows');\nCOMMIT;\n"; } | sudo -u finacademy psql -v ON_ERROR_STOP=1 -d finacademy
fi
ln -sfn "$release" /opt/finance-academy/current
cp -a dist/. /var/www/finance-academy/
find /var/www/finance-academy -type d -exec chmod 755 {} +
find /var/www/finance-academy -type f -exec chmod 644 {} +
systemctl restart finance-academy
sleep 1
curl --fail --silent --show-error https://finacademy.kz/api/health
