import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const secrets=JSON.parse(readFileSync('.local/seed-state.json','utf8'));
const base='https://finacademy.kz';let requests=0;
const page=await fetch(base,{signal:AbortSignal.timeout(20000)});assert.equal(page.status,200);const html=await page.text();
for(const asset of [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(m=>m[1])){const r=await fetch(base+asset,{signal:AbortSignal.timeout(20000)});assert.equal(r.status,200);assert.ok((await r.arrayBuffer()).byteLength>0);requests++;}
function session(){let cookie='';return async(path,data)=>{
  requests++;
  const response=await fetch(base+'/api'+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json',Origin:base}:{}),...(cookie?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(20000)});
  assert.ok(response.ok,path+' HTTP '+response.status);
  const fresh=response.headers.get('set-cookie');if(fresh){cookie=fresh.split(';')[0];assert.match(fresh,/Secure/);assert.match(fresh,/HttpOnly/);assert.match(fresh,/SameSite=Strict/);}
  assert.equal(response.headers.get('x-app-revision'),'vps-20261016-1');
  if(response.headers.get('content-type')?.includes('application/pdf'))return Buffer.from(await response.arrayBuffer());
  return response.json();
};}
const admin=session(),student=session();
await admin('/auth/login',{login:'admin',password:secrets.adminPassword});
await admin('/auth/me');await admin('/admin/dashboard');
const tests=await admin('/admin/tests');
for(const lang of ['RU','KZ']){const t=tests.find(t=>t.title===`Тесты МСФО 210 (${lang})`);assert.equal(t.bank_count,200);assert.equal(t.minutes,60);assert.equal(t.question_count,25);assert.equal(t.pass_percent,50);}
await student('/auth/login',{login:'student024',password:secrets.studentPassword});
await student('/student/tests');const history=await student('/student/results');assert.ok(history.length);
const pdf=await student('/student/attempts/'+history[0].id+'/certificate');assert.equal(pdf.subarray(0,4).toString(),'%PDF');
for(const from of ['http://finacademy.kz/','https://www.finacademy.kz/']){const r=await fetch(from,{redirect:'manual',signal:AbortSignal.timeout(20000)});assert.equal(r.status,308);assert.equal(r.headers.get('location'),'https://finacademy.kz/');requests++;}
const report={base,verified_at:new Date().toISOString(),passed:true,requests,checks:['valid HTTPS','secure sessions','admin login/dashboard','student login/tests/history','migrated result PDF','200 RU /200 KZ','HTTP/www canonical redirects'],load_test_run:false};
writeFileSync('output/migration-https.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
