import pg from 'pg';
import {createHash,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
if(process.env.PGDATABASE!=='finacademy_audit_check')throw new Error('Disposable database required');
const pool=new pg.Pool({host:'/var/run/postgresql',user:'finacademy',database:process.env.PGDATABASE});
const checks=[], requests=[];
const cookies={};
try {
  const time=new Date().toISOString(),future=new Date(Date.now()+3600000).toISOString();
  await pool.query("INSERT INTO groups(id,name,created_at) VALUES('g','Audit original',$1),('next','Audit next',$1)",[time]);
  for(const [id,role]of[['student','student'],['admin','admin']]){
    await pool.query("INSERT INTO users(id,name,login,login_key,password_hash,role,group_id,created_at) VALUES($1,$1,$1,$1,'unused',$2,'g',$3)",[id,role,time]);
    const token=randomUUID();cookies[id]='fa_session='+token;
    await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[createHash('sha256').update(token).digest('hex'),id,future]);
  }
  await pool.query("INSERT INTO tests(id,title,discipline,question_count,published,minutes,proctor_mode,created_at) VALUES('t','Audit fixture','QA',1,1,60,'log',$1)",[time]);
  await pool.query("INSERT INTO questions(id,test_id,text,options_json,correct_id,content_hash,created_at) VALUES('q','t','Audit question',$1,'A','qa',$2)",[JSON.stringify([{id:'A',text:'First'},{id:'B',text:'Second'}]),time]);
  await pool.query("INSERT INTO assignments(id,test_id,group_id,max_attempts,minutes,created_at) VALUES('a','t','g',3,60,$1)",[time]);
  async function call(path,data,user='student',expected=200){
    const response=await fetch('http://127.0.0.1:3001/api'+path,{method:data?'POST':'GET',headers:{Cookie:cookies[user],...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
    const body=await response.json(); requests.push({path,status:response.status});
    assert.equal(response.status,expected,JSON.stringify(body));return body;
  }
  const attempt=await call('/student/start',{test_id:'t'},'student',201),client=randomUUID(),url='/student/attempts/'+attempt.id;
  assert.equal((await pool.query('SELECT group_id_snapshot FROM attempts WHERE id=$1',[attempt.id])).rows[0].group_id_snapshot,'g');
  await call(url+'/lease',{clientId:client});
  await call(url+'/save',{clientId:client,version:1,answers:{q:'A'}});
  await call(url+'/save',{clientId:client,version:1,answers:{q:'B'}},'student',409);
  await call(url+'/finish',{clientId:client,version:1,answers:{q:'B'}},'student',409);
  await pool.query('UPDATE attempts SET client_lease_until=$1 WHERE id=$2',[Date.now()+1000,attempt.id]);
  await call(url+'/save',{clientId:client,version:1,answers:{q:'A'}});
  assert.ok(Number((await pool.query('SELECT client_lease_until FROM attempts WHERE id=$1',[attempt.id])).rows[0].client_lease_until)>Date.now()+50000);
  await call(url+'/lease',{clientId:randomUUID()},'student',409);
  checks.push('version conflict rejected, lost-response retry renewed lease, second tab refused');
  const event={id:randomUUID(),kind:'focus',occurredAt:time};
  await pool.query('UPDATE attempts SET client_lease_until=$1 WHERE id=$2',[Date.now()+1000,attempt.id]);
  await call(url+'/events',{clientId:client,epoch:0,events:[event]});
  assert.ok(Number((await pool.query('SELECT client_lease_until FROM attempts WHERE id=$1',[attempt.id])).rows[0].client_lease_until)>Date.now()+50000);
  const returned=await call(url+'/events',{clientId:client,epoch:0,events:[{...event,returnedAt:new Date().toISOString(),durationMs:300}]});
  assert.equal(returned.violation_count,1);assert.equal(Number((await pool.query('SELECT duration_ms FROM proctor_events WHERE event_id=$1',[event.id])).rows[0].duration_ms),300);
  checks.push('event batch renewed lease and retained one event with duration');
  assert.equal((await call(url+'/finish',{clientId:client,version:1,answers:{q:'A'}})).percent,100);
  await call('/admin/students/bulk',{ids:['student'],group_id:'next'},'admin');
  assert.equal((await call('/admin/results?group_id=g',undefined,'admin'))[0].id,attempt.id);
  assert.equal((await call('/admin/results?group_id=next',undefined,'admin')).length,0);
  checks.push('historical flow preserved after moving student');
  const created=await call('/admin/import/students/commit',{mode:'skip',rows:[{name:'Әбілова Айдана',login:'Әбілова Айдана',group:'Original'}]},'admin');
  assert.equal(created.created,1);
  const updated=await call('/admin/import/students/commit',{mode:'update',rows:[{name:'Әбілова Айдана Ерланқызы',login:'ӘБІЛОВА   АЙДАНА',group:'Updated'}]},'admin');
  assert.equal(updated.updated,1);assert.equal(updated.created,0);
  const preview=await call('/admin/import/assignments/preview',{logins:['ӘБІЛОВА   АЙДАНА','Әбілова Айдана']},'admin');
  assert.equal(preview.length,1);assert.equal(preview[0].user.name,'Әбілова Айдана Ерланқызы');
  checks.push('Unicode import updates existing student; assignment preview normalizes names');
  const dashboard=await call('/admin/dashboard',undefined,'admin');assert.equal(dashboard.active,0);assert.equal(dashboard.completed,1);
  checks.push('dashboard works with background expiry');
  const report={checked_at:new Date().toISOString(),database:'disposable PostgreSQL',passed:true,load_test_run:false,checks,requests};
  writeFileSync('/var/lib/finance-academy/audit-postgres.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await pool.end();}
