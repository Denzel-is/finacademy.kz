set -eu
systemctl is-active --quiet finance-academy
if systemctl is-active --quiet finance-academy-policy-check; then
  echo 'Temporary policy service is still running' >&2; exit 1
fi
test "$(readlink -f /opt/finance-academy/current)" = /opt/finance-academy/releases/20261016-2
curl --fail --silent --show-error -D /root/flows-final-headers.txt -o /dev/null https://finacademy.kz/api/health
grep -qi '^x-app-revision: flows-20261016-2' /root/flows-final-headers.txt
sudo -u finacademy psql -v ON_ERROR_STOP=1 -tA -d finacademy <<'SQL'
SELECT jsonb_build_object(
  'revision','flows-20261016-2',
  'temporary_database_removed',NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='finacademy_policy_check'),
  'qa_flow_removed',NOT EXISTS(SELECT 1 FROM groups WHERE id='db833724-ce63-4f83-8e66-0367f6eaa2eb'),
  'qa_students_removed',NOT EXISTS(SELECT 1 FROM users WHERE id IN('fcb05bad-1010-4223-b15b-675753bff303','3ff68a38-f9ca-458b-847c-c7eb5e28d359')),
  'legacy_admin_blocked',(SELECT blocked=1 FROM users WHERE login='admin'),
  'administrators',(SELECT jsonb_agg(jsonb_build_object('name',name,'login',login,'role',role) ORDER BY login) FROM users WHERE role<>'student' AND blocked=0),
  'banks',(SELECT jsonb_agg(jsonb_build_object('title',t.title,'questions',(SELECT count(*) FROM questions q WHERE q.test_id=t.id AND q.archived=0),'sample',t.question_count,'minutes',t.minutes,'pass_points',t.pass_percent) ORDER BY t.title) FROM tests t WHERE t.title IN('Тесты МСФО 210 (RU)','Тесты МСФО 210 (KZ)','Тесты МСФООС 210 (RU)','Тесты МСФООС 210 (KZ)')),
  'totals',jsonb_build_object('users',(SELECT count(*) FROM users),'groups',(SELECT count(*) FROM groups),'tests',(SELECT count(*) FROM tests),'questions',(SELECT count(*) FROM questions),'attempts',(SELECT count(*) FROM attempts)),
  'active_attempts',(SELECT count(*) FROM attempts WHERE status='active' AND (deadline IS NULL OR deadline>to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
  'load_test_run',false
);
SQL
