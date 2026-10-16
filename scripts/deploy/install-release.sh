set -eu
release=/opt/finance-academy/releases/20261016-1
install -d -o finacademy -g finacademy -m 750 "$release"
tar -xzf /root/finance-academy-release.tar.gz -C "$release"
chown -R finacademy:finacademy "$release"
cd "$release"
sudo -u finacademy npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/var/log/finance-academy-install.log 2>&1
sudo -u finacademy psql -v ON_ERROR_STOP=1 -d finacademy < /root/postgres-schema.sql
install -o finacademy -g finacademy -m 600 /root/finance-academy-data.json /var/lib/finance-academy/migration-source.json
sudo -u finacademy node server/import-data.mjs /var/lib/finance-academy/migration-source.json
ln -sfn "$release" /opt/finance-academy/current
