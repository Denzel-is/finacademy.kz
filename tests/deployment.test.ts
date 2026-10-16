import {test} from 'node:test';
import assert from 'node:assert/strict';
import {postgresSql} from '../server/database.ts';
import worker from '../worker/cloudflare.ts';
test('PostgreSQL placeholders preserve quoted literals and quoted identifiers',()=>{
  assert.equal(postgresSql(`SELECT '?' AS "?", 'it''s ?' WHERE id=? AND login=? COLLATE NOCASE`),`SELECT '?' AS "?", 'it''s ?' WHERE id=$1 AND login=$2`);
});
test('Migration redirects pages while keeping old credentials and writes out of the new API',async()=>{
  const env:any={MIGRATION_TARGET:'https://finacademy.kz',MIGRATION_MODE:'redirect'};
  const page=await worker.fetch(new Request('https://old.example/account?tab=tests'),env,{} as ExecutionContext);
  assert.equal(page.status,308);assert.equal(page.headers.get('location'),'https://finacademy.kz/account?tab=tests');
  const api=await worker.fetch(new Request('https://old.example/api/auth/login',{method:'POST',body:'private'}),env,{} as ExecutionContext);
  assert.equal(api.status,410);assert.equal(api.headers.get('location'),null);assert.match((await api.json() as any).error,/finacademy.kz/);
  const maintenance=await worker.fetch(new Request('https://old.example/'),{...env,MIGRATION_MODE:'maintenance'},{} as ExecutionContext);
  assert.equal(maintenance.status,503);
});
