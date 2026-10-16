import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/api.ts';
import {organizationInstant} from '../shared/time.ts';
import {reconcileDraft,draftFromServer,syncAction} from '../shared/exam-sync.ts';
import type {Attempt} from '../shared/types.ts';
import {database} from './support.ts';
import app from '../worker/index.ts';
import {digest} from '../worker/security.ts';

test('Overlapping reads share one request; writes invalidate that request without caching old data',async()=>{
  let resolve!: (r:Response)=>void;
  let calls=0;
  const fetchMock=mock.method(globalThis,'fetch',async(_url:any,options:any)=>{
    if(++calls===1)return new Promise<Response>(r=>{resolve=r;});
    return Response.json({value:options.method==='POST'?'changed':'fresh'});
  });
  try {
    const first=api('/admin/tests'),same=api('/admin/tests');
    assert.equal(first,same);assert.equal(fetchMock.mock.callCount(),1);
    await api('/admin/tests',{title:'change'});
    assert.equal((await api('/admin/tests')).value,'fresh');
    resolve(Response.json({value:'old'}));assert.equal((await first).value,'old');
    await api('/admin/tests');assert.equal(fetchMock.mock.callCount(),4,'completed results never stay cached');
  }finally{fetchMock.mock.restore();}
});
test('Assignment input uses the organization zone regardless of the administrator computer',()=>{
  assert.equal(organizationInstant('2026-10-16T10:00','Asia/Almaty'),'2026-10-16T05:00:00.000Z');
  assert.equal(organizationInstant('2026-10-16T10:00','Europe/Moscow'),'2026-10-16T07:00:00.000Z');
  assert.throws(()=>organizationInstant('2026-02-30T10:00','Asia/Almaty'));
  assert.throws(()=>organizationInstant('invalid','Asia/Almaty'));
});
const server={version:5,answers:{a:'B',b:'A'},proctor_epoch:0,questions:['a','b','c'].map(id=>({id,text:id,options:[{id:'A',text:'A'},{id:'B',text:'B'}]}))} as Attempt;
test('Recovery merges independent edits and requires a choice before replacing a remote answer',()=>{
  const saved={version:8,baseVersion:3,baseAnswers:{a:'A',b:'A'},answers:{a:'A',b:'B',c:'A'},events:[],epoch:0};
  const merged=reconcileDraft(saved,server);
  assert.deepEqual(merged.answers,{a:'B',b:'B',c:'A'});assert.equal(merged.conflicts.length,0,'unchanged old answers must not overwrite newer server data');
  const conflict=reconcileDraft({...saved,baseAnswers:{a:'B',b:'A'},answers:{a:'A',b:'B'}},{...server,answers:{a:undefined as any,b:'A'}});
  assert.deepEqual(conflict.conflicts,[{id:'a',local:'A',server:undefined}]);
  const legacy=reconcileDraft({version:99,answers:{a:'A'},epoch:0,events:[]},server);
  assert.equal(legacy.conflicts.length,1,'a high local version alone never authorizes overwriting another tab');
  assert.equal(draftFromServer(server,merged.answers).version,6);
  assert.deepEqual(reconcileDraft({...saved,epoch:1},server).answers,server.answers);
});
test('Quiet focus does not cause a request; pending events replace an idle heartbeat',()=>{
  assert.equal(syncAction(false,false,5000,30000),null);
  assert.equal(syncAction(false,true,5000,30000),'events');
  assert.equal(syncAction(true,true,5000,30000),'save');
  assert.equal(syncAction(false,false,30000,30000),'lease');
});
async function fixture(){
  const {sql,db}=database();const now=new Date().toISOString(),future=new Date(Date.now()+3600000).toISOString();
  sql.prepare("INSERT INTO groups(id,name,created_at) VALUES('g','Original',?)").run(now);
  for(const [id,role]of[['s','student'],['admin','admin']])sql.prepare('INSERT INTO users(id,name,login,login_key,password_hash,role,group_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,id,id,id,'unused',role,'g',now);
  for(const id of ['s','admin'])sql.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await digest(id),id,future);
  sql.prepare("INSERT INTO tests(id,title,discipline,question_count,published,minutes,proctor_mode,created_at) VALUES('t','Audit','QA',1,1,60,'log',?)").run(now);
  sql.prepare("INSERT INTO questions(id,test_id,text,options_json,correct_id,content_hash,created_at) VALUES('q','t','Audit question',?,'A','audit',?)").run(JSON.stringify([{id:'A',text:'First'},{id:'B',text:'Second'}]),now);
  sql.prepare("INSERT INTO assignments(id,test_id,group_id,max_attempts,minutes,created_at) VALUES('a','t','g',3,60,?)").run(now);
  async function call(path:string,data?:any,user='s'){
    const response=await app.fetch(new Request('https://qa.local/api'+path,{method:data?'POST':'GET',headers:{Cookie:'fa_session='+user,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined}),{DB:db} as any);
    return {status:response.status,value:await response.json() as any};
  }
  const attempt=(await call('/student/start',{test_id:'t'})).value,client=crypto.randomUUID(),url='/student/attempts/'+attempt.id;
  await call(url+'/lease',{clientId:client});
  return {sql,call,client,url,attempt};
}
test('Same-version saves and finalization cannot replace acknowledged answers; duplicate retries renew the lease',async()=>{
  const {sql,call,client,url,attempt}=await fixture();
  try {
    assert.equal((await call(url+'/save',{clientId:client,version:1,answers:{q:'A'}})).status,200);
    assert.equal((await call(url+'/save',{clientId:client,version:1,answers:{q:'B'}})).status,409);
    assert.equal((await call(url+'/finish',{clientId:client,version:1,answers:{q:'B'}})).status,409);
    sql.prepare('UPDATE attempts SET client_lease_until=? WHERE id=?').run(Date.now()+1000,attempt.id);
    assert.equal((await call(url+'/save',{clientId:client,version:1,answers:{q:'A'}})).status,200);
    assert.ok(Number(sql.prepare('SELECT client_lease_until FROM attempts WHERE id=?').get(attempt.id)!.client_lease_until)>Date.now()+50000);
    assert.equal((await call(url+'/lease',{clientId:crypto.randomUUID()})).status,409,'opening a second tab must not automatically steal the attempt');
    assert.equal((await call(url+'/finish',{clientId:client,version:1,answers:{q:'A'}})).value.percent,100);
  }finally{sql.close();}
});
test('Event-only synchronization renews ownership and duplicate returns retain their duration',async()=>{
  const {sql,call,client,url,attempt}=await fixture();
  try {
    sql.prepare('UPDATE attempts SET client_lease_until=? WHERE id=?').run(Date.now()+1000,attempt.id);
    const event={id:crypto.randomUUID(),kind:'focus',occurredAt:new Date().toISOString()};
    await call(url+'/events',{clientId:client,epoch:0,events:[event]});
    assert.ok(Number(sql.prepare('SELECT client_lease_until FROM attempts WHERE id=?').get(attempt.id)!.client_lease_until)>Date.now()+50000);
    const result=await call(url+'/events',{clientId:client,epoch:0,events:[{...event,returnedAt:new Date().toISOString(),durationMs:300}]});
    assert.equal(result.value.violation_count,1);
    assert.equal(sql.prepare('SELECT duration_ms FROM proctor_events WHERE event_id=?').get(event.id)!.duration_ms,300);
  }finally{sql.close();}
});
test('Unicode import updates an existing mixed-case FIO account instead of creating a duplicate',async()=>{
  const {sql,call}=await fixture();
  try {
    const first=await call('/admin/import/students/commit',{mode:'skip',rows:[{name:'Әбілова Айдана',login:'Әбілова Айдана',group:'First'}]},'admin');
    assert.equal(first.status,200);assert.equal(first.value.created,1);assert.equal(first.value.credentials[0].login,'Әбілова Айдана');
    const second=await call('/admin/import/students/commit',{mode:'update',rows:[{name:'Әбілова Айдана Ерланқызы',login:'ӘБІЛОВА   АЙДАНА',group:'Second'}]},'admin');
    assert.equal(second.status,200);assert.equal(second.value.updated,1);assert.equal(second.value.created,0);
    const row=sql.prepare("SELECT u.name,g.name AS group_name FROM users u JOIN groups g ON g.id=u.group_id WHERE login_key='әбілова айдана'").get()!;
    assert.equal(row.name,'Әбілова Айдана Ерланқызы');assert.equal(row.group_name,'Second');
    const preview=await call('/admin/import/assignments/preview',{logins:['ӘБІЛОВА   АЙДАНА','Әбілова Айдана']},'admin');
    assert.equal(preview.value.length,1);assert.equal(preview.value[0].user.name,'Әбілова Айдана Ерланқызы');
  }finally{sql.close();}
});

test('Moving a student does not move historical results into their new flow',async()=>{
  const {sql,call,client,url,attempt}=await fixture();
  try {
    await call(url+'/finish',{clientId:client,version:1,answers:{q:'A'}});
    sql.prepare("INSERT INTO groups(id,name,created_at) VALUES('new','New',?)").run(new Date().toISOString());
    await call('/admin/students/bulk',{ids:['s'],group_id:'new'},'admin');
    const original=await call('/admin/results?group_id=g',undefined,'admin');
    const moved=await call('/admin/results?group_id=new',undefined,'admin');
    assert.equal(original.status,200);assert.equal(original.value[0].id,attempt.id);
    assert.equal(moved.value.length,0);
  }finally{sql.close();}
});
