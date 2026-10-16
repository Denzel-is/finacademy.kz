#!/bin/sh
set -eu
umask 077
directory=/var/backups/finance-academy
install -d -o root -g root -m 700 "$directory"
file="$directory/finacademy-$(date -u +%Y%m%dT%H%M%SZ).dump"
runuser -u postgres -- pg_dump --format=custom --dbname=finacademy > "$file.tmp"
runuser -u postgres -- pg_restore --list < "$file.tmp" >/dev/null
mv "$file.tmp" "$file"
find /var/backups/finance-academy -maxdepth 1 -type f -name 'finacademy-*.dump' -mtime +14 -delete
echo "PostgreSQL backup completed: $(basename "$file")"
