set -eu
chmod 700 /usr/local/sbin/finance-academy-backup
cat >/etc/systemd/system/finance-academy-backup.service <<'UNIT'
[Unit]
Description=FinanceAcademy PostgreSQL backup
After=postgresql.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/finance-academy-backup
UNIT
cat >/etc/systemd/system/finance-academy-backup.timer <<'UNIT'
[Unit]
Description=Daily FinanceAcademy backup
[Timer]
OnCalendar=*-*-* 02:00:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now finance-academy-backup.timer
systemctl start finance-academy-backup.service
systemctl is-active finance-academy-backup.timer
