// Sequential functional regression in a disposable PostgreSQL database only.
import pg from 'pg';
import { createHash, randomUUID, pbkdf2Sync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
if (process.env.PGDATABASE !== 'finacademy_audit_check') throw new Error('Disposable database required');
const pool = new pg.Pool({ host: '/var/run/postgresql', user: 'finacademy', database: process.env.PGDATABASE });
const checks = [], requests = [], cookies = {};
const sha = value => createHash('sha256').update(value).digest('hex');
try {
  const time = new Date().toISOString(), future = new Date(Date.now() + 3600000).toISOString();
  const password = 'Disposable-regression-123', salt = randomUUID();
  const legacyHash = `pbkdf2$100000$${salt}$${pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex')}`;
  await pool.query("INSERT INTO groups(id,name,created_at) VALUES('security-g','Security regression',$1)",[time]);
  for (const [id, role, name] of [['security-student','student','Әбілова Айдана'],['security-admin','admin','Security administrator']]) {
    await pool.query("INSERT INTO users(id,name,login,login_key,password_hash,role,group_id,created_at) VALUES($1,$2,$1,$1,$3,$4,'security-g',$5)",[id,name,legacyHash,role,time]);
    const token = randomUUID(); cookies[id] = 'fa_session=' + token;
    await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[sha(token),id,future]);
  }
  await pool.query("INSERT INTO tests(id,title,discipline,question_count,published,minutes,proctor_mode,created_at) VALUES('security-t','Security fixture','QA',1,1,60,'log',$1)",[time]);
  await pool.query("INSERT INTO questions(id,test_id,text,options_json,correct_id,content_hash,created_at) VALUES('security-q','security-t','Security fixture question',$1,'A','security-qa',$2)",[JSON.stringify([{id:'A',text:'First'},{id:'B',text:'Second'}]),time]);
  await pool.query("INSERT INTO assignments(id,test_id,group_id,max_attempts,minutes,created_at) VALUES('security-a','security-t','security-g',3,60,$1)",[time]);
  async function call(path, data, user='security-student', expected=200) {
    const response = await fetch('http://127.0.0.1:3001/api'+path,{ method:data?'POST':'GET',headers:{Cookie:cookies[user],...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined });
    const value = await response.json(); requests.push({path:path.split('cursor=')[0],status:response.status});
    assert.equal(response.status,expected,JSON.stringify(value));
    if (path==='/auth/login' && response.status===200) cookies[user]=response.headers.get('set-cookie').split(';')[0];
    return value;
  }
  await call('/auth/login',{login:'security-admin',password},'security-admin');
  const upgraded = (await pool.query("SELECT password_hash FROM users WHERE id='security-admin'")).rows[0].password_hash;
  assert.equal(upgraded.split('$')[1],'600000');
  assert.equal(pbkdf2Sync(password,upgraded.split('$')[2],600000,32,'sha256').toString('hex'),upgraded.split('$')[3]);
  checks.push('legacy login upgrades to supported PBKDF2 600000 without changing the password');

  const attempt = await call('/student/start',{test_id:'security-t'},'security-student',201), clientId = randomUUID(), url = '/student/attempts/'+attempt.id;
  await call(url+'/lease',{clientId});
  await call(url+'/save',{clientId,version:1,answers:{'security-q':'A'}});
  const first = {id:randomUUID(),kind:'offline',occurredAt:time};
  const accepted = await call(url+'/events',{clientId,epoch:0,events:[first]});
  assert.deepEqual(accepted.accepted_event_ids,[first.id]); assert.equal(accepted.log_truncated,false);
  await pool.query("INSERT INTO proctor_events(attempt_id,epoch,event_id,kind,occurred_at,received_at,counted) SELECT $1,0,'security-event-'||n,'offline',$2,$2,0 FROM generate_series(1,999) n",[attempt.id,time]);
  const rejected = randomUUID();
  const capped = await call(url+'/events',{clientId,epoch:0,events:[{...first,returnedAt:time,durationMs:750},{id:rejected,kind:'focus',occurredAt:time}]});
  assert.equal(capped.log_truncated,true); assert.deepEqual(capped.accepted_event_ids,[first.id]); assert.deepEqual(capped.rejected_event_ids,[rejected]);
  assert.equal(Number((await pool.query('SELECT count(*) FROM proctor_events WHERE attempt_id=$1',[attempt.id])).rows[0].count),1000);
  assert.equal(Number((await pool.query('SELECT duration_ms FROM proctor_events WHERE attempt_id=$1 AND event_id=$2',[attempt.id,first.id])).rows[0].duration_ms),750);
  const detail = await call('/admin/attempts/'+attempt.id,undefined,'security-admin');
  assert.equal(detail.event_count,1000); assert.equal(detail.events_has_more,true); assert.equal(detail.log_truncated,true);
  assert.equal((await call(url+'/finish',{clientId,version:1,answers:{'security-q':'A'}})).percent,100);
  checks.push('proctor cap returns explicit accepted/rejected IDs; return updates remain accepted at the cap; grading unaffected');

  // The fixture is inserted in one statement. HTTP requests stay sequential.
  await pool.query(`INSERT INTO attempts(id,user_id,test_id,assignment_id,test_title,student_name,group_name,group_id_snapshot,status,started_at,deadline,finished_at,pass_percent,question_snapshot_json,answer_key_json,percent,passed,proctor_mode,proctor_limit)
    SELECT 'security-result-'||lpad(n::text,4,'0'),'security-student','security-t','security-a','Security fixture','Әбілова Айдана','Security regression','security-g','completed','2026-01-01T00:00:00.000Z',NULL,'2026-01-01T00:01:00.000Z',50,'[]','{}',80,1,'log',3 FROM generate_series(1,501) n`);
  const page = await call('/admin/results?page=1&page_size=50&group_id=security-g&search='+encodeURIComponent('ӘБІЛОВА'),undefined,'security-admin');
  assert.equal(page.total,502); assert.equal(page.items.length,50); assert.equal(page.stats.completed,502); assert.equal(page.stats.average,80);
  const nextPage = await call('/admin/results?page=2&page_size=50&group_id=security-g',undefined,'security-admin');
  assert.equal(new Set([...page.items,...nextPage.items].map(row=>row.id)).size,100);
  const exported = await call('/admin/results/export?group_id=security-g',undefined,'security-admin');
  assert.equal(exported.items.length,500); assert.ok(exported.next_cursor);
  const remainder = await call('/admin/results/export?group_id=security-g&cursor='+encodeURIComponent(exported.next_cursor),undefined,'security-admin');
  assert.equal(remainder.items.length,2); assert.equal(remainder.next_cursor,null); assert.equal(remainder.snapshot,exported.snapshot);
  assert.equal(new Set([...exported.items,...remainder.items].map(row=>row.id)).size,502);
  await call('/admin/results/export?group_id=other&cursor='+encodeURIComponent(exported.next_cursor),undefined,'security-admin',400);
  await call('/admin/results/export',undefined,'security-student',403);
  checks.push('server pagination and aggregate counts; Unicode search; stable composite export chunks; filter and role isolation');

  const created = await call('/admin/students',{name:'Новая Анна',login:'security-new-student'},'security-admin',201);
  assert.equal(created.password.length,16);
  await call('/auth/login',{login:created.login,password:created.password},'security-new-student');
  await call('/student/tests',undefined,'security-new-student',403);
  for (const key of ['login:security-student','password-change:security-student']) await pool.query('INSERT INTO rate_limits(key,count,reset_at) VALUES($1,20,$2)',[sha(key),Date.now()+600000]);
  const reset = await call('/admin/students/reset-passwords',{ids:['security-student',created.id]},'security-admin');
  assert.equal(reset.credentials.length,2); assert.equal(new Set(reset.credentials.map(row=>row.password)).size,2);
  for (const credential of reset.credentials) {
    const current = (await pool.query('SELECT password_hash,must_change_password FROM users WHERE id=$1',[credential.id])).rows[0];
    assert.equal(credential.password.length,16); assert.equal(current.must_change_password,1);
    const [,iterations,credentialSalt,expected] = current.password_hash.split('$');
    assert.equal(pbkdf2Sync(credential.password,credentialSalt,Number(iterations),32,'sha256').toString('hex'),expected);
  }
  assert.equal(Number((await pool.query('SELECT count(*) FROM rate_limits WHERE key=ANY($1::text[])',[[sha('login:security-student'),sha('password-change:security-student')]])).rows[0].count),0);
  assert.equal(Number((await pool.query("SELECT count(*) FROM sessions WHERE user_id='security-student'")).rows[0].count),0);
  checks.push('individual generated temporary passwords and mandatory change; bulk reset issues distinct secrets, revokes sessions and clears throttles');
  const flowInput = {name:'Security one-time credentials',text:'1. Повтор Анна\n2. Повтор Дана',request_id:randomUUID()};
  const flow = await call('/admin/flows',flowInput,'security-admin',201);
  assert.equal(flow.credentials_available,true); assert.equal(new Set(flow.credentials.map(row=>row.password)).size,2);
  const hashesBefore = (await pool.query('SELECT login,password_hash FROM users WHERE group_id=$1 ORDER BY login',[flow.id])).rows;
  const replay = await call('/admin/flows',flowInput,'security-admin');
  assert.equal(replay.credentials_available,false); assert.ok(replay.credentials.every(row=>row.password==='Не выдаётся повторно; сбросьте пароль'));
  assert.deepEqual((await pool.query('SELECT login,password_hash FROM users WHERE group_id=$1 ORDER BY login',[flow.id])).rows,hashesBefore);
  checks.push('flow creation issues distinct secrets once; replay does not rotate or reveal plaintext passwords');
  const report = {checked_at:new Date().toISOString(),database:'disposable PostgreSQL',passed:true,load_test_run:false,checks,requests};
  writeFileSync('/var/lib/finance-academy/security-postgres.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
} finally { await pool.end(); }
