import pg from 'pg';
import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync(process.argv[2],'utf8'));
const merge=process.argv.includes('--merge');
const pool = new pg.Pool({host:'/var/run/postgresql',database:'finacademy',user:'finacademy'});
const client=await pool.connect();
try {
  await client.query('BEGIN');
  for(const [table,rows] of Object.entries(data)) {
    if(!['groups','users','tests','questions','assignments','attempts','proctor_events','audit_log','settings'].includes(table)) throw new Error('Unknown table');
    for(const row of rows) {
      const keys=Object.keys(row);
      const columns=keys.map(k=>'"'+k.replaceAll('"','""')+'"').join(',');
      const primary=table==='settings'?['key']:table==='proctor_events'?['attempt_id','epoch','event_id']:['id'];
      const conflict=merge||table==='settings'?`ON CONFLICT(${primary.join(',')}) DO UPDATE SET ${keys.filter(k=>!primary.includes(k)).map(k=>`"${k}"=excluded."${k}"`).join(',')}`:'';
      await client.query(`INSERT INTO "${table}"(${columns}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) ${conflict}`,Object.values(row));
    }
    const count=Number((await client.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n);
    if(merge?count<rows.length:count!==rows.length)throw new Error(`Row count mismatch: ${table}`);
    console.log(`${table}: ${count} verified`);
  }
  await client.query('COMMIT');
} catch(error){await client.query('ROLLBACK');throw error;}
finally{client.release();await pool.end();}
