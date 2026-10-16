#!/usr/bin/env python3
"""Local-only health report; no credentials, messages or paid services."""
import datetime
import fcntl
import json
import pathlib
import shutil
import subprocess
import sys
import urllib.request

STATE = pathlib.Path('/var/lib/finance-academy-maintenance')
STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
lock = (STATE/'health.lock').open('a')
try:
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit(0)
now = datetime.datetime.now(datetime.timezone.utc)
checks = []

def add(name, ok, **details):
    checks.append({'name': name, 'ok': bool(ok), **details})

for unit in ('finance-academy.service', 'nginx.service', 'postgresql.service', 'finance-academy-backup.timer', 'finance-academy-restore-check.timer', 'certbot.timer'):
    result = subprocess.run(['systemctl', 'is-active', '--quiet', unit], timeout=10, check=False)
    add(unit, result.returncode == 0)
try:
    with urllib.request.urlopen('http://127.0.0.1:3000/api/ready', timeout=23) as response:
        add('database_readiness', response.status == 200 and json.load(response).get('ok') is True)
except Exception:
    add('database_readiness', False)
for mount in ('/', '/var/lib/postgresql', '/var/backups/finance-academy'):
    space = shutil.disk_usage(mount)
    free_percent = round(space.free / space.total * 100, 1)
    add('disk:'+mount, space.free >= 2 * 1024**3 and free_percent >= 10, freeBytes=space.free, freePercent=free_percent)
backups = sorted(pathlib.Path('/var/backups/finance-academy').glob('finacademy-*.dump'))
latest = backups[-1] if backups else None
age = round(now.timestamp() - latest.stat().st_mtime) if latest else None
add('backup_freshness', latest is not None and latest.stat().st_size > 0 and age is not None and 0 <= age <= 28*3600, ageSeconds=age, latest=latest.name if latest else None)
try:
    restore = json.loads((STATE/'restore.json').read_text())
    restore_age = round((now - datetime.datetime.fromisoformat(restore['finishedAt'])).total_seconds())
    add('restore_verification', restore.get('ok') is True and 0 <= restore_age <= 8*86400, ageSeconds=restore_age)
except (OSError, ValueError, KeyError, TypeError):
    add('restore_verification', False)
try:
    certificate = subprocess.run(['openssl','x509','-checkend',str(14*86400),'-noout','-in','/etc/letsencrypt/live/finacademy.kz/cert.pem'], timeout=10, capture_output=True, check=False)
    add('certificate_valid_14_days', certificate.returncode == 0)
except (OSError, subprocess.TimeoutExpired):
    add('certificate_valid_14_days', False)
report = {'ok':all(item['ok'] for item in checks),'checkedAt':now.isoformat(),'checks':checks}
temporary = STATE/'health.json.tmp'
temporary.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
temporary.chmod(0o600)
temporary.replace(STATE/'health.json')
print(json.dumps({'ok':report['ok'],'failed':[item['name'] for item in checks if not item['ok']]}))
sys.exit(0 if report['ok'] else 1)
