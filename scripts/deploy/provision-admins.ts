import pg from 'pg';
import {readFileSync} from 'node:fs';
import {hashPassword} from '../../worker/security.ts';
import {normalizeLogin} from '../../shared/flows.ts';
const admins=JSON.parse(readFileSync(process.argv[2],'utf8'));
const pool=new pg.Pool({host:'/var/run/postgresql',user:'finacademy',database:'finacademy'});
const client=await pool.connect();
try{
  await client.query('BEGIN');
  const active=[];
  for(const admin of admins){
    const existing=(await client.query('SELECT id,role FROM users WHERE login_key=$1',[normalizeLogin(admin.login)])).rows[0];
    if(existing?.role==='student')throw new Error('Admin login conflicts with a student');
    const id=existing?.id||admin.id;active.push(id);
    await client.query("INSERT INTO users(id,name,login,login_key,password_hash,role,blocked,must_change_password,created_at) VALUES($1,$2,$3,$4,$5,'admin',0,0,$6) ON CONFLICT(id) DO UPDATE SET name=excluded.name,login=excluded.login,login_key=excluded.login_key,password_hash=excluded.password_hash,role='admin',blocked=0,must_change_password=0",[id,admin.name,admin.login,normalizeLogin(admin.login),await hashPassword(admin.password),new Date().toISOString()]);
  }
  await client.query("UPDATE users SET blocked=1,role='admin' WHERE role<>'student' AND NOT(id=ANY($1::text[]))",[active]);
  await client.query("DELETE FROM sessions WHERE user_id IN(SELECT id FROM users WHERE role='admin' AND blocked=1)");
  await client.query('COMMIT');console.log('Two administrators provisioned with identical admin permissions; legacy technical administrator disabled.');
}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await pool.end();}
