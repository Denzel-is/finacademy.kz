import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const secrets=JSON.parse(readFileSync(process.argv[2],'utf8'));
const base=process.env.BASE_URL||'http://127.0.0.1:3000';
let requests=0;
function session(){let cookie='';return async(path,data,method,expected=200,binary=false)=>{
  requests++;
  const response=await fetch(base+'/api'+path,{method:method||(data===undefined?'GET':'POST'),headers:{...(cookie?{Cookie:cookie}:{}),...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(20000)});
  const fresh=response.headers.get('set-cookie');if(fresh)cookie=fresh.split(';')[0];
  const value=binary?Buffer.from(await response.arrayBuffer()):await response.json();
  assert.equal(response.status,expected,path+': '+(binary?'binary':JSON.stringify(value)));
  if(path==='/auth/login')assert.match(fresh,/HttpOnly.*Secure|Secure.*HttpOnly/);
  return value;
};}
const admin=session(), student=session(),other=session();
const suffix=Date.now().toString(36), password=randomUUID();
let testId,userId,otherId,configuration;
try {
  await admin('/auth/login',{login:'admin',password:secrets.adminPassword});
  for(const route of ['/auth/me','/admin/dashboard','/admin/students','/admin/groups','/admin/assignments','/admin/results','/admin/administrators'])await admin(route);
  const tests=await admin('/admin/tests');
  for(const lang of ['RU','KZ']){const t=tests.find(t=>t.title===`Тесты МСФО 210 (${lang})`);assert.ok(t);assert.equal(t.bank_count,200);assert.equal(t.question_count,25);assert.equal(t.minutes,60);assert.equal(t.pass_percent,50);}
  const source=tests.find(t=>t.title==='Тесты МСФО 210 (RU)');
  const bank=await admin('/admin/questions?test_id='+source.id);
  configuration={...source,title:'Проверка переноса VPS '+suffix,published:0,max_attempts:3,proctor_mode:'warn',fullscreen:0};
  testId=(await admin('/admin/tests',configuration,undefined,201)).id;
  const imported=await admin('/admin/import/questions/commit',{test_id:testId,rows:bank.map(q=>({text:q.text,options:q.options,correct_id:q.correct_id}))});
  assert.equal(imported.created,200);
  const repeated=await admin('/admin/import/questions/commit',{test_id:testId,rows:bank.map(q=>({text:q.text,options:q.options,correct_id:q.correct_id}))});assert.equal(repeated.created,0);
  await admin('/admin/tests/'+testId,{...configuration,published:1},'PUT');
  userId=(await admin('/admin/students',{name:'Проверка переноса VPS',login:'vps_'+suffix,password},undefined,201)).id;
  otherId=(await admin('/admin/students',{name:'Проверка изоляции VPS',login:'vps_other_'+suffix,password},undefined,201)).id;
  await admin('/admin/assignments',{test_id:testId,user_ids:[userId],group_ids:[],starts_at:null,ends_at:null,max_attempts:3});
  await admin('/admin/assignments',{test_id:testId,user_ids:[userId],group_ids:[],starts_at:null,ends_at:null,max_attempts:3});
  const assignments=await admin('/admin/assignments');assert.equal(assignments.filter(a=>a.test_id===testId&&a.user_id===userId).length,1);
  const copied=await admin('/admin/questions?test_id='+testId), key=Object.fromEntries(copied.map(q=>[q.id,q.correct_id]));
  await student('/auth/login',{login:'vps_'+suffix,password});await other('/auth/login',{login:'vps_other_'+suffix,password});
  await student('/admin/students',undefined,undefined,403);
  const a=await student('/student/start',{test_id:testId},undefined,201);
  assert.equal(a.status,'active');assert.equal(a.questions.length,25);assert.equal(new Set(a.questions.map(q=>q.id)).size,25);assert.equal(Date.parse(a.deadline)-Date.parse(a.started_at),3600000);assert.ok(!('answer_key_json'in a));assert.ok(a.questions.every(q=>!('correct_id'in q)));
  await other('/student/attempts/'+a.id,undefined,undefined,404);
  const clientId=randomUUID();await student(`/student/attempts/${a.id}/lease`,{clientId,force:true});
  const answers=Object.fromEntries(a.questions.map((q,i)=>[q.id,i<13?key[q.id]:q.options.find(o=>o.id!==key[q.id]).id]));
  await student(`/student/attempts/${a.id}/save`,{clientId,version:a.version+1,answers});
  const heartbeat=await student(`/student/attempts/${a.id}/lease`,{clientId,compact:true});assert.ok(!heartbeat.questions);assert.equal(heartbeat.version,a.version+1);
  const recovery=await student('/student/attempts/'+a.id);assert.deepEqual(recovery.questions,a.questions);assert.deepEqual(recovery.answers,answers);
  const event={id:randomUUID(),kind:'hidden',occurredAt:new Date().toISOString(),returnedAt:new Date().toISOString(),durationMs:0};
  const events=await student(`/student/attempts/${a.id}/events`,{clientId,epoch:a.proctor_epoch,events:[event,event]});assert.equal(events.violation_count,1);
  const input={clientId,version:a.version+2,answers};
  const finish=await student(`/student/attempts/${a.id}/finish`,input);assert.equal(finish.percent,52);assert.equal(finish.passed,1);assert.equal(finish.score,13);
  const repeat=await student(`/student/attempts/${a.id}/finish`,input);assert.equal(repeat.finished_at,finish.finished_at);
  const checked=await admin('/admin/attempts/'+a.id);assert.deepEqual(checked.attempt.answers,answers);
  const pdf=await student(`/student/attempts/${a.id}/certificate`,undefined,undefined,200,true);assert.equal(pdf.subarray(0,4).toString(),'%PDF');
  await admin('/admin/dashboard');
  const report={passed:true,verified_at:new Date().toISOString(),base,requests,checks:['admin sections','RU/KZ 200 banks /25/60min/50points','bulk import idempotence','assignment idempotence','25 unique questions','server deadline','key privacy','role and ownership isolation','atomic save and compact heartbeat','snapshot recovery','proctor deduplication','52-point grade','idempotent finish','administrative answer verification','PDF generation'],load_test_run:false};
  writeFileSync(process.env.REPORT_PATH||'/var/lib/finance-academy/functional-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally {
  if(testId&&configuration)await admin('/admin/tests/'+testId,{...configuration,published:0},'PUT');
  if(userId)await admin('/admin/students/'+userId,{blocked:1},'PUT');
  if(otherId)await admin('/admin/students/'+otherId,{blocked:1},'PUT');
}
