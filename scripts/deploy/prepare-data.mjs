import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const db = new DatabaseSync(':memory:');
db.exec(readFileSync('.local/finance-academy-export.sql','utf8'));
const tables = ['groups','users','tests','questions','assignments','attempts','proctor_events','audit_log','settings'];
const data = Object.fromEntries(tables.map(table => [table,db.prepare(`SELECT * FROM ${table}`).all()]));
for (const test of data.tests.filter(t=>/^Тесты МСФО 210 \((RU|KZ)\)$/.test(t.title))) {
  if(data.questions.filter(q=>q.test_id===test.id&&!q.archived).length!==200) throw new Error('Real bank incomplete');
}
if (data.users.some(u=>u.login!==u.login.toLowerCase())) throw new Error('Login normalization requires review');
writeFileSync('.local/finance-academy-data.json',JSON.stringify(data));
const counts=Object.fromEntries(tables.map(t=>[t,data[t].length]));
writeFileSync('output/migration-source.json',JSON.stringify({exported_at:new Date().toISOString(),counts,sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex'),sessions_migrated:false},null,2));
let schema=readFileSync('migrations/0001_initial.sql','utf8').replace('PRAGMA foreign_keys=ON;','').replace(' COLLATE NOCASE','').replace(/\bREAL\b/g,'DOUBLE PRECISION').replace('reset_at INTEGER','reset_at BIGINT').replace('client_lease_until INTEGER','client_lease_until BIGINT');
schema += '\n'+readFileSync('migrations/0002_session_expiry.sql','utf8')+'\n'+readFileSync('server/compat.sql','utf8');
writeFileSync('.local/postgres-schema.sql',schema);
console.log(JSON.stringify({tables:counts,real_banks:'200 RU / 200 KZ',sessions:'New sign-in required on new domain'}));
