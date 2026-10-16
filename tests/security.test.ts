import { test } from 'node:test';
import assert from 'node:assert/strict';
import app from '../worker/index.ts';
import { boundedRequest } from '../worker/request.ts';
import { digest, hashPassword, verifyPassword, PASSWORD_ITERATIONS } from '../worker/security.ts';
import { database } from './support.ts';

test('Body limits count streamed bytes, cancel overflow, and reject forged lengths before authentication', async () => {
  let pulls = 0, cancelled = false;
  const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024)); }, cancel() { cancelled = true; } });
  const request = new Request('https://qa.local/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '1' }, body: stream, duplex: 'half' } as RequestInit);
  const response = await app.fetch(request, { DB: { prepare() { throw new Error('Database must not be reached'); } } } as any);
  assert.equal(response.status, 413); assert.equal(cancelled, true); assert.ok(pulls < 10);
  const text = '{"name":"Әбілова"}';
  const normal = new Request('https://qa.local/', { method: 'POST', body: text });
  assert.equal(await (await boundedRequest(normal, 100)).text(), text);
  await assert.rejects(() => boundedRequest(new Request('https://qa.local/', { method: 'POST', body: text }), 15));
});

test('Password upgrade remains compatible with legacy hashes and rejects unsafe work factors', async () => {
  const salt = 'legacy-salt', password = 'Legacy-password-123';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: new TextEncoder().encode(salt) }, key, 256);
  const legacy = `pbkdf2$100000$${salt}$${Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  assert.equal(await verifyPassword(password, legacy), true);
  assert.equal(await verifyPassword('wrong', legacy), false);
  const modern = await hashPassword(password);
  assert.equal(modern.split('$')[1], String(PASSWORD_ITERATIONS));
  assert.equal(await verifyPassword(password, modern), true);
  assert.equal(await verifyPassword(password, legacy.replace('$100000$', '$999999999$')), false);
  const { sql, db } = database();
  try {
    sql.prepare("INSERT INTO users(id,name,login,login_key,password_hash,role,created_at) VALUES('admin','Admin','admin','admin',?,'admin',?)").run(legacy, new Date().toISOString());
    const call = () => app.fetch(new Request('https://qa.local/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'admin', password }) }), { DB: db } as any);
    const login = await call(); assert.equal(login.status, 200);
    assert.equal(String(sql.prepare("SELECT password_hash FROM users WHERE id='admin'").get()!.password_hash).split('$')[1], String(PASSWORD_ITERATIONS));
    assert.match(login.headers.get('set-cookie') || '', /HttpOnly/); assert.match(login.headers.get('set-cookie') || '', /Secure/); assert.match(login.headers.get('set-cookie') || '', /SameSite=Strict/);
  } finally { sql.close(); }
});

test('A password reset during login prevents a stale credential from issuing a session, and account throttling returns its actual reset', async () => {
  const { sql, db } = database(), password = 'Valid-password-123', hash = await hashPassword(password);
  try {
    sql.prepare("INSERT INTO users(id,name,login,login_key,password_hash,role,created_at) VALUES('admin','Admin','admin','admin',?,'admin',?)").run(hash, new Date().toISOString());
    const call = (headers = {}) => app.fetch(new Request('https://qa.local/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ login: 'admin', password }) }), { DB: db } as any);
    db.beforeRun = async (query: string) => {
      if (query.startsWith('INSERT INTO sessions')) sql.prepare("UPDATE users SET password_hash='reset-concurrently' WHERE id='admin'").run();
    };
    assert.equal((await call()).status, 401);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n, 0);
    db.beforeRun = undefined;
    const key = await digest('login:admin');
    sql.prepare('INSERT INTO rate_limits(key,count,reset_at) VALUES(?,15,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,reset_at=excluded.reset_at').run(key, Date.now() + 3000);
    const throttled = await call(); assert.equal(throttled.status, 429);
    assert.ok(Number(throttled.headers.get('retry-after')) <= 3);
    assert.equal((await call({ 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  } finally { sql.close(); }
});

async function fixture() {
  const { sql, db } = database(), timestamp = new Date().toISOString(), future = new Date(Date.now() + 3600000).toISOString();
  sql.prepare("INSERT INTO groups(id,name,created_at) VALUES('g','Group',?)").run(timestamp);
  for (const [id, role] of [['student', 'student'], ['admin', 'admin']]) {
    sql.prepare('INSERT INTO users(id,name,login,login_key,password_hash,role,group_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, id, id, id, 'unused', role, 'g', timestamp);
    sql.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await digest(id), id, future);
  }
  sql.prepare("INSERT INTO tests(id,title,discipline,question_count,published,minutes,proctor_mode,created_at) VALUES('t','Security','QA',1,1,60,'log',?)").run(timestamp);
  sql.prepare("INSERT INTO questions(id,test_id,text,options_json,correct_id,content_hash,created_at) VALUES('q','t','Fixture question',?,'A','fixture',?)").run(JSON.stringify([{ id: 'A', text: 'First' }, { id: 'B', text: 'Second' }]), timestamp);
  sql.prepare("INSERT INTO assignments(id,test_id,group_id,max_attempts,minutes,created_at) VALUES('assignment','t','g',3,60,?)").run(timestamp);
  async function call(path: string, data?: any, user = 'student') {
    const response = await app.fetch(new Request('https://qa.local/api' + path, { method: data ? 'POST' : 'GET', headers: { Cookie: 'fa_session=' + user, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined }), { DB: db } as any);
    return { status: response.status, value: await response.json() as any };
  }
  const attempt = (await call('/student/start', { test_id: 't' })).value, clientId = crypto.randomUUID(), path = '/student/attempts/' + attempt.id;
  await call(path + '/lease', { clientId });
  return { sql, db, call, attempt, clientId, path };
}

test('Proctor cap explicitly acknowledges recorded IDs and rejects new IDs while still accepting return updates', async () => {
  const { sql, call, attempt, clientId, path } = await fixture();
  try {
    const first = crypto.randomUUID(), received = new Date().toISOString();
    sql.prepare("INSERT INTO proctor_events(attempt_id,epoch,event_id,kind,occurred_at,received_at,counted) VALUES(?,0,?,'offline',?,?,0)").run(attempt.id, first, received, received);
    sql.prepare("WITH RECURSIVE fixture(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM fixture WHERE n<999) INSERT INTO proctor_events(attempt_id,epoch,event_id,kind,occurred_at,received_at,counted) SELECT ?,0,'fixture-' || n,'offline',?,?,0 FROM fixture").run(attempt.id, received, received);
    const rejected = crypto.randomUUID();
    const response = await call(path + '/events', { clientId, epoch: 0, events: [{ id: first, kind: 'offline', occurredAt: received, returnedAt: received, durationMs: 900 }, { id: rejected, kind: 'focus', occurredAt: received }] });
    assert.equal(response.status, 200); assert.equal(response.value.log_truncated, true);
    assert.deepEqual(response.value.accepted_event_ids, [first]); assert.deepEqual(response.value.rejected_event_ids, [rejected]);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM proctor_events WHERE attempt_id=?').get(attempt.id)!.n, 1000);
    assert.equal(sql.prepare('SELECT duration_ms FROM proctor_events WHERE event_id=?').get(first)!.duration_ms, 900);
    const detail = await call('/admin/attempts/' + attempt.id, undefined, 'admin');
    assert.equal(detail.value.event_count, 1000); assert.equal(detail.value.events.length, 200); assert.equal(detail.value.events_has_more, true); assert.equal(detail.value.log_truncated, true);
  } finally { sql.close(); }
});

test('Administrative password resets also clear login and password-change throttles for the selected student', async () => {
  const { sql, call } = await fixture();
  try {
    const keys = await Promise.all(['login:student','password-change:student'].map(digest));
    async function block() { for (const key of keys) sql.prepare('INSERT INTO rate_limits(key,count,reset_at) VALUES(?,20,?)').run(key,Date.now()+60000); }
    await block();
    assert.equal((await call('/admin/students/student/reset-password', {}, 'admin')).status, 200);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM rate_limits').get()!.n, 0);
    await block();
    assert.equal((await call('/admin/students/reset-passwords', { ids: ['student'] }, 'admin')).status, 200);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM rate_limits').get()!.n, 0);
  } finally { sql.close(); }
});

test('New students receive individual temporary credentials, including imports, without changing existing accounts', async () => {
  const { sql, call, db } = await fixture();
  try {
    const first = await call('/admin/students', { name: 'Новая Анна', login: 'Новая Анна' }, 'admin');
    const second = await call('/admin/students', { name: 'Новый Иван', login: 'Новый Иван' }, 'admin');
    assert.equal(first.status, 201); assert.equal(second.status, 201);
    assert.equal(first.value.password.length, 16); assert.notEqual(first.value.password, second.value.password);
    assert.equal(sql.prepare('SELECT must_change_password FROM users WHERE id=?').get(first.value.id)!.must_change_password, 1);
    assert.equal(await verifyPassword(first.value.password, String(sql.prepare('SELECT password_hash FROM users WHERE id=?').get(first.value.id)!.password_hash)), true);
    assert.equal((await call('/admin/students', { name: 'Слабый Пароль', login: 'Слабый Пароль', password: '123456' }, 'admin')).status, 400);
    let persistedRows: any[] = [];
    db.beforeRun = async (query: string, parameters: any[]) => {
      if (query.startsWith('INSERT INTO users') && query.includes('FROM json_each')) persistedRows = JSON.parse(parameters[1]);
    };
    const imported = await call('/admin/import/students/commit', { rows: [
      { name: 'Импорт Анна', login: 'Импорт Анна', password: '' },
      { name: 'Импорт Иван', login: 'Импорт Иван', password: 'Авто' },
      { name: 'Импорт Дана', login: 'Импорт Дана', password: 'Explicit-password-456' },
    ] }, 'admin');
    assert.equal(imported.status, 200); assert.equal(imported.value.created, 3);
    const credentials = imported.value.credentials;
    assert.equal(new Set(credentials.map((credential: any) => credential.password)).size, 3);
    assert.equal(credentials.find((credential: any) => credential.login === 'Импорт Дана').password, 'Explicit-password-456');
    assert.ok(persistedRows.every(row => !Object.hasOwn(row, 'password')), 'only hashes are bound into the database insert');
    for (const credential of credentials) {
      const row = sql.prepare('SELECT password_hash,must_change_password FROM users WHERE login=?').get(credential.login)!;
      assert.equal(row.must_change_password, 1); assert.equal(await verifyPassword(credential.password, String(row.password_hash)), true);
    }
    assert.equal(sql.prepare("SELECT password_hash FROM users WHERE id='student'").get()!.password_hash, 'unused', 'existing accounts are never bulk rotated during provisioning');
  } finally { sql.close(); }
});

test('Results paginate on the server and export beyond 5000 with stable keyset order, literal search and filter binding', async () => {
  const { sql, call, attempt } = await fixture();
  try {
    sql.prepare("UPDATE attempts SET status='completed',finished_at=started_at,percent=80,passed=1,student_name='Literal%_Name' WHERE id=?").run(attempt.id);
    // One local fixture statement, no concurrent clients or production requests.
    sql.prepare(`WITH RECURSIVE fixture(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM fixture WHERE n<=5000)
      INSERT INTO attempts(id,user_id,test_id,assignment_id,test_title,student_name,group_name,group_id_snapshot,status,started_at,deadline,finished_at,pass_percent,question_snapshot_json,answer_key_json,percent,passed,proctor_mode,proctor_limit)
      SELECT 'fixture-' || printf('%05d',n),'student','t','assignment','Security','Fixture student','Group','g','completed',?,NULL,?,50,'[]','{}',80,1,'log',3 FROM fixture`).run('2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z');
    const page = await call('/admin/results?page=2&page_size=50&group_id=g', undefined, 'admin');
    assert.equal(page.status, 200); assert.equal(page.value.total, 5002); assert.equal(page.value.items.length, 50); assert.equal(page.value.stats.completed, 5002); assert.equal(page.value.stats.average, 80);
    const search = await call('/admin/results?page=1&search=' + encodeURIComponent('%_'), undefined, 'admin');
    assert.equal(search.value.total, 1, 'search wildcard characters are literal');
    assert.equal((await call('/admin/results?page=0', undefined, 'admin')).status, 400);
    assert.equal((await call('/admin/results/export', undefined, 'student')).status, 403);
    const ids: string[] = []; let cursor = '', snapshot = '', turns = 0;
    do {
      const result = await call('/admin/results/export?group_id=g' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), undefined, 'admin');
      assert.equal(result.status, 200); if (snapshot) assert.equal(result.value.snapshot, snapshot); else snapshot = result.value.snapshot;
      ids.push(...result.value.items.map((item: any) => item.id)); cursor = result.value.next_cursor || '';
      if (++turns === 1) {
        const invalid = await call('/admin/results/export?group_id=changed&cursor=' + encodeURIComponent(cursor), undefined, 'admin'); assert.equal(invalid.status, 400);
        // Newer rows cannot sneak into later chunks of the same export.
        sql.prepare("UPDATE attempts SET started_at=? WHERE id='fixture-00001'").run(new Date(Date.now() + 60000).toISOString());
      }
    } while (cursor && turns < 20);
    assert.equal(cursor, ''); assert.equal(ids.length, 5001); assert.equal(new Set(ids).size, ids.length); assert.equal(ids.includes('fixture-00001'), false);
    assert.equal((await call('/admin/results', undefined, 'admin')).value.length, 5000, 'legacy clients retain array response');
  } finally { sql.close(); }
});
