#!/bin/sh
set -eu
umask 077
directory=/var/backups/finance-academy
install -d -o root -g root -m 700 "$directory"
exec 9>/run/lock/finance-academy-backup.lock
flock -w 60 9
file="$directory/finacademy-$(date -u +%Y%m%dT%H%M%SZ).dump"
cleanup() { rm -f -- "$file.tmp" "$file.sha256.tmp"; }
trap cleanup EXIT HUP INT TERM
test ! -e "$file"
runuser -u postgres -- pg_dump --format=custom --dbname=finacademy > "$file.tmp"
test -s "$file.tmp"
runuser -u postgres -- pg_restore --list < "$file.tmp" >/dev/null
mv "$file.tmp" "$file"
(cd "$directory" && sha256sum "$(basename "$file")") > "$file.sha256.tmp"
mv "$file.sha256.tmp" "$file.sha256"
find "$directory" -maxdepth 1 -type f -name 'finacademy-*.dump' -mtime +14 -exec sh -c 'for dump do rm -f -- "$dump" "$dump.sha256"; done' sh {} +
trap - EXIT HUP INT TERM
echo "PostgreSQL backup completed: $(basename "$file")"
