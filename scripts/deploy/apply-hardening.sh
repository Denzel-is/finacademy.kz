#!/bin/sh
# Apply after deploying the server build containing GET /api/ready. This script
# does not change SSH or firewall access. Every replaced file is recoverable.
set -eu
umask 077
test "$(id -u)" = 0
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec 9>/run/lock/finance-academy-hardening.lock
flock -w 60 9
curl --fail --silent --max-time 23 http://127.0.0.1:3000/api/ready >/dev/null
rollback_dir="/var/backups/finance-academy-config/$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -o root -g root -m 700 "$rollback_dir" /var/lib/finance-academy-maintenance
install -d -o root -g root -m 755 /etc/nginx/snippets /etc/systemd/system/finance-academy.service.d
changed=0
app_changed=0
for timer in finance-academy-restore-check.timer finance-academy-maintenance.timer; do
  if systemctl is-enabled --quiet "$timer"; then printf '%s\n' "$timer" >> "$rollback_dir/enabled-timers"; fi
done
replace() {
  input=$1 target=$2 mode=$3
  test -f "$source_dir/$input"
  if test -f "$target" && cmp -s "$source_dir/$input" "$target"; then return; fi
  if test -e "$target"; then cp -a --parents "$target" "$rollback_dir"; fi
  printf '%s\n' "$target" >> "$rollback_dir/changed"
  install -o root -g root -m "$mode" "$source_dir/$input" "$target"
  changed=1
}
rollback() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ "$result" -ne 0 ]; then
    for timer in finance-academy-restore-check.timer finance-academy-maintenance.timer; do
      if ! test -f "$rollback_dir/enabled-timers" || ! grep -qxF "$timer" "$rollback_dir/enabled-timers"; then systemctl disable --now "$timer" >/dev/null 2>&1 || true; fi
    done
    if test -f "$rollback_dir/changed"; then
      while IFS= read -r target; do
        if test -e "$rollback_dir$target"; then cp -a "$rollback_dir$target" "$target"; else rm -f -- "$target"; fi
      done < "$rollback_dir/changed"
    fi
    systemctl daemon-reload
    if nginx -t; then systemctl reload nginx || true; fi
    if [ "$app_changed" = 1 ]; then systemctl restart finance-academy || true; fi
    echo "Hardening failed; original configuration restored from $rollback_dir" >&2
  fi
  exit "$result"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
replace security-headers.conf /etc/nginx/snippets/finance-academy-security.conf 644
replace proxy-api.conf /etc/nginx/snippets/finance-academy-proxy.conf 644
replace nginx-hardening.conf /etc/nginx/sites-available/finance-academy 644
if ! test -f /etc/systemd/system/finance-academy.service.d/security.conf || ! cmp -s "$source_dir/systemd-hardening.conf" /etc/systemd/system/finance-academy.service.d/security.conf; then app_changed=1; fi
replace systemd-hardening.conf /etc/systemd/system/finance-academy.service.d/security.conf 644
replace backup-safe.sh /usr/local/sbin/finance-academy-backup 700
replace restore-check.sh /usr/local/sbin/finance-academy-restore-check 700
replace maintenance-check.py /usr/local/sbin/finance-academy-maintenance 700
for unit in finance-academy-restore-check.service finance-academy-restore-check.timer finance-academy-maintenance.service finance-academy-maintenance.timer; do replace "$unit" "/etc/systemd/system/$unit" 644; done
nginx -t
systemd-analyze verify /etc/systemd/system/finance-academy.service /etc/systemd/system/finance-academy-restore-check.service /etc/systemd/system/finance-academy-maintenance.service
systemctl daemon-reload
if [ "$app_changed" = 1 ]; then systemctl restart finance-academy; fi
for attempt in 1 2 3 4 5; do
  if curl --fail --silent --max-time 23 http://127.0.0.1:3000/api/ready >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent --max-time 23 http://127.0.0.1:3000/api/ready >/dev/null
if [ "$changed" = 1 ]; then systemctl reload nginx; fi
systemctl enable --now finance-academy-restore-check.timer finance-academy-maintenance.timer
trap - EXIT HUP INT TERM
echo "Hardening applied. Configuration snapshot: $rollback_dir"
echo 'Run finance-academy-backup, then systemctl start finance-academy-restore-check.service finance-academy-maintenance.service to produce the first verification reports.'
