import pg from 'pg';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
if(!['before','after'].includes(process.argv[2]))throw new Error('Snapshot name required');
const pool=new pg.Pool({host:'/var/run/postgresql',user:'finacademy',database:'finacademy'});
try {
  const tables={};
  for(const table of ['users','groups','tests','questions','assignments','attempts','proctor_events']){
    const rows=(await pool.query(`SELECT (to_jsonb(t)-'group_id_snapshot')::text AS canonical FROM ${table} t ORDER BY canonical`)).rows;
    const hash=createHash('sha256');for(const row of rows)hash.update(row.canonical+'\n');
    tables[table]={count:rows.length,sha256:hash.digest('hex')};
  }
  const active=Number((await pool.query("SELECT count(*) FROM attempts WHERE status='active'")).rows[0].count);
  const report={checked_at:new Date().toISOString(),active,tables};
  writeFileSync('/var/lib/finance-academy/audit-'+process.argv[2]+'.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{await pool.end();}
