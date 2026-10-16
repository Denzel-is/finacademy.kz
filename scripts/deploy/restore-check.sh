#!/bin/sh
# Restore into a fresh database, verify constraints, and always remove only
# this process's disposable database. Never restore over the application DB.
set -eu
umask 077
state=/var/lib/finance-academy-maintenance
install -d -o root -g root -m 700 "$state"
exec 9>/run/lock/finance-academy-restore-check.lock
flock -n 9 || exit 0
database="finacademy_restore_$(date -u +%Y%m%d%H%M%S)_$$"
case "$database" in finacademy_restore_[0-9]*_[0-9]*) ;; *) exit 1;; esac
created=0
stage=select_backup
backup=
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cleanup() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ "$created" = 1 ]; then
    if ! runuser -u postgres -- dropdb --if-exists --force "$database"; then result=1; stage=cleanup; fi
  fi
  STATUS="$result" STAGE="$stage" BACKUP="$backup" STARTED="$started" STATE="$state" python3 - <<'PY'
import datetime,json,os,pathlib
state=pathlib.Path(os.environ['STATE'])
report={'ok':os.environ['STATUS']=='0','startedAt':os.environ['STARTED'],'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'backup':pathlib.Path(os.environ['BACKUP']).name,'stage':os.environ['STAGE']}
temporary=state/'restore.json.tmp'; temporary.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');temporary.chmod(0o600);temporary.replace(state/'restore.json')
PY
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
backup=$(find /var/backups/finance-academy -maxdepth 1 -type f -name 'finacademy-*.dump' | sort | tail -n 1)
test -n "$backup" && test -s "$backup"
stage=checksum
if [ -f "$backup.sha256" ]; then (cd /var/backups/finance-academy && sha256sum --check "$(basename "$backup").sha256"); fi
stage=create_database
runuser -u postgres -- createdb --owner=finacademy --template=template0 "$database"
created=1
stage=restore
runuser -u postgres -- pg_restore --exit-on-error --no-owner --no-privileges --dbname="$database" < "$backup"
stage=verify_constraints
# pg_restore exits on violations; also require application tables, the expected
# unique active-attempt guard, nonnegative revisions, and no orphan attempts.
runuser -u postgres -- psql -X --dbname="$database" --set=ON_ERROR_STOP=1 --no-align --tuples-only <<'SQL'
DO $$ BEGIN
  IF to_regclass('public.users') IS NULL OR to_regclass('public.attempts') IS NULL OR to_regclass('public.questions') IS NULL THEN RAISE EXCEPTION 'Missing application tables'; END IF;
  IF to_regclass('public.idx_one_active_attempt') IS NULL THEN RAISE EXCEPTION 'Missing active-attempt uniqueness guard'; END IF;
  IF EXISTS (SELECT 1 FROM attempts WHERE version<0) THEN RAISE EXCEPTION 'Invalid answer revision'; END IF;
  IF EXISTS (SELECT 1 FROM attempts a LEFT JOIN users u ON u.id=a.user_id WHERE u.id IS NULL) THEN RAISE EXCEPTION 'Orphan attempt'; END IF;
END $$;
SELECT json_build_object('users',(SELECT count(*) FROM users),'attempts',(SELECT count(*) FROM attempts),'questions',(SELECT count(*) FROM questions));
SQL
stage=complete
