import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, statSync, renameSync } from 'node:fs';
const path = '.local/finance-academy-export.sql';
// Never let a failed fresh download silently reuse an older migration snapshot.
if(existsSync(path))renameSync(path,path+'.previous-'+Date.now());
const r = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js','d1','export','finance-academy','--remote','--output',path], {encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
if (r.status === 0 && existsSync(path) && statSync(path).size > 0) console.log('D1 export saved privately');
else {
  const link = (r.stdout + r.stderr).match(/https:\/\/[^\s]+\.r2\.cloudflarestorage\.com\/[^\s]+/);
  if (!link) throw new Error('D1 export unavailable; no download URL returned');
  writeFileSync('.local/export-download-url.txt', link[0]);
  console.log('D1 export prepared; private download URL saved for VPS transfer');
}
