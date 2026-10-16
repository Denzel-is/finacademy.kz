import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkPath,checkContent,scan} from '../scripts/check-secrets.mjs';
test('Git guard rejects data, keys and environment files while allowing source and examples',()=>{
  for(const path of ['.local/access.md','output/credentials.json','.env.production','backup.dump','keys/server.key','customer.docx','customer.pdf','copied/id_ed25519','admin-accounts.json','keys/host.ppk'])assert.ok(checkPath(path));
  for(const path of ['worker/index.ts','migrations/0004_attempt_flow.sql','.env.example','.dev.vars.example','public/fonts/GolosText.ttf'])assert.equal(checkPath(path),null);
});
test('Staged scanning accepts public binary assets and blocks unknown binaries without decoding them',async()=>{
  const previous=process.cwd(),dir=await mkdtemp(join(tmpdir(),'finacademy-secret-guard-'));
  const messages=[];
  const errorLog=mock.method(console,'error',(...args)=>{messages.push(args.join(' '));});
  const infoLog=mock.method(console,'log',()=>{});
  const git=(...args)=>{const r=spawnSync('git',args,{cwd:dir,encoding:'utf8'});assert.equal(r.status,0);};
  try{
    git('init','--quiet');git('config','core.autocrlf','false');
    await mkdir(join(dir,'public','fonts'),{recursive:true});
    await writeFile(join(dir,'public','fonts','qa.ttf'),Buffer.from([0,1,0,0,65,66,67]));
    git('add','--all');process.chdir(dir);assert.doesNotThrow(()=>scan(true));
    await writeFile(join(dir,'copied-data.bin'),Buffer.from([0,9,10,255]));git('add','--all');
    assert.throws(()=>scan(true),/Commit blocked/);
    assert.ok(messages.some(message=>message.includes('unrecognized binary file')));
  }finally{
    process.chdir(previous);errorLog.mock.restore();infoLog.mock.restore();
    assert.equal(dirname(resolve(dir)),resolve(tmpdir()));
    await rm(dir,{recursive:true,force:true});
  }
});
test('Git guard detects credentials without returning their values',()=>{
  const token='gh'+'p_'+ 'a'.repeat(36);
  const matches=checkContent('const value="'+token+'";');
  assert.equal(matches[0].rule,'GitHub token');assert.equal(JSON.stringify(matches).includes(token),false);
  assert.equal(checkContent('const token = process.env.GITHUB_TOKEN;').length,0);
  assert.equal(checkContent(JSON.stringify({['admin'+'Password']:['a','private','value','123'].join('-')}))[0].rule,'credential literal');
  assert.equal(checkContent('const database = "'+'postgres'+ '://'+'owner'+':'+'private-password'+'@'+'localhost/academy";')[0].rule,'credential in URL');
  assert.equal(checkContent('const token = "placeholder";').length,0);
});
