// Two competing starts in a disposable PostgreSQL database; this is not a load test.
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
if (process.env.PGDATABASE !== 'finacademy_policy_check') throw new Error('Disposable database required');
const pool = new pg.Pool({host:'/var/run/postgresql',user:'finacademy',database:process.env.PGDATABASE});
try {
  const time = new Date().toISOString(), future = new Date(Date.now()+600000).toISOString();
  await pool.query("INSERT INTO groups(id,name,created_at) VALUES('g','Capacity regression',$1)",[time]);
  await pool.query("INSERT INTO tests(id,title,discipline,question_count,published,minutes,created_at) VALUES('t','Capacity regression','QA',1,1,10,$1)",[time]);
  await pool.query("INSERT INTO questions(id,test_id,text,options_json,correct_id,content_hash,created_at) VALUES('q','t','Regression question',$1,'A','qa',$2)",[JSON.stringify([{id:'A',text:'Yes'},{id:'B',text:'No'}]),time]);
  await pool.query("INSERT INTO assignments(id,test_id,group_id,max_attempts,minutes,created_at) VALUES('a','t','g',2,10,$1)",[time]);
  for (let i=0;i<51;i++) await pool.query("INSERT INTO users(id,name,login,login_key,password_hash,role,group_id,created_at) VALUES($1,$1,$1,$1,'unused','student','g',$2)",['fixture'+i,time]);
  await pool.query("INSERT INTO attempts(id,user_id,test_id,assignment_id,test_title,student_name,group_name,started_at,deadline,pass_percent,question_snapshot_json,answer_key_json,proctor_mode,proctor_limit) SELECT 'fixture-attempt'||n,'fixture'||n,'t','a','Regression','Fixture','Capacity regression',$1,$2,50,'[]','{}','off',3 FROM generate_series(0,48) n",[time,future]);
  const cookies=[];
  for (let i=49;i<51;i++) {
    const token=randomUUID(); cookies.push('fa_session='+token);
    await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[createHash('sha256').update(token).digest('hex'),'fixture'+i,future]);
  }
  const statuses=await Promise.all(cookies.map(async cookie=>{
    const r=await fetch('http://127.0.0.1:3001/api/student/start',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({test_id:'t'})});
    const body=await r.json(); if (![201,429].includes(r.status)) throw new Error(JSON.stringify({status:r.status,body})); return r.status;
  }));
  assert.deepEqual(statuses.sort(),[201,429]);
  const count=Number((await pool.query("SELECT count(*) FROM attempts WHERE status='active' AND deadline>$1",[time])).rows[0].count);
  assert.equal(count,50);
  const report={checked_at:new Date().toISOString(),database:'disposable PostgreSQL',database_fixtures:49,competing_start_requests:2,statuses,active_after:count,passed:true,load_test_run:false};
  writeFileSync('/var/lib/finance-academy/flows-admission.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally { await pool.end(); }
