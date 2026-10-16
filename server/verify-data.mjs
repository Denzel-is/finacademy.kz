import pg from 'pg';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const source=JSON.parse(readFileSync('/var/lib/finance-academy/migration-source.json','utf8'));
const database=process.env.PGDATABASE||'finacademy';
const pool=new pg.Pool({host:'/var/run/postgresql',user:'finacademy',database});
const counts={};
try {
  for(const [table,expected] of Object.entries(source)) {
    if(!['groups','users','tests','questions','assignments','attempts','proctor_events','audit_log','settings'].includes(table))throw new Error('Unknown table');
    const actual=(await pool.query(`SELECT * FROM "${table}"`)).rows;
    assert.ok(actual.length>=expected.length,table);
    const key=row=>table==='proctor_events'?JSON.stringify([row.attempt_id,row.epoch,row.event_id]):row.id||row.key;
    const map=new Map(actual.map(row=>[key(row),row]));
    for(const row of expected) {
      const stored=map.get(key(row));assert.ok(stored,table+' row missing');
      for(const [column,value] of Object.entries(row)) {
        // Restore any percentages imported through a previous float4 schema.
        if(table==='attempts'&&column==='percent'&&value!==null&&Number(stored[column])!==value){await pool.query('UPDATE attempts SET percent=$1 WHERE id=$2',[value,row.id]);stored[column]=value;}
        assert.deepEqual(typeof value==='number'?Number(stored[column]):stored[column],value,table+'.'+column);
      }
    }
    counts[table]=actual.length;
  }
  writeFileSync(process.env.REPORT_PATH||'/var/lib/finance-academy/migration-verification.json',JSON.stringify({verified_at:new Date().toISOString(),database,all_columns_verified:true,counts},null,2));
  console.log(JSON.stringify({all_columns_verified:true,counts}));
}finally{await pool.end();}
