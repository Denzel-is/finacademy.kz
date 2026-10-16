set -eu
backup=$(find /var/backups/finance-academy -maxdepth 1 -type f -name 'finacademy-*.dump' | sort | tail -n 1)
test -n "$backup"
sudo -u postgres createdb -O finacademy finacademy_restore_check
cat "$backup" | sudo -u postgres pg_restore --exit-on-error --dbname=finacademy_restore_check
cd /opt/finance-academy/current
sudo -u finacademy env PGDATABASE=finacademy_restore_check REPORT_PATH=/var/lib/finance-academy/restore-verification.json node server/verify-data.mjs
sudo -u postgres dropdb finacademy_restore_check
echo 'Backup restored into a separate database and migration rows verified'
