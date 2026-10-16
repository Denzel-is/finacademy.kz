import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function checkPath(path) {
  const value=path.replaceAll('\\','/');
  if(/(^|\/)(?:\.local|\.wrangler|output|backups|attachments|node_modules|dist|build)(\/|$)/i.test(value))return 'private/generated directory';
  if(/(^|\/)\.env(?:\.|$)/i.test(value)&&!value.endsWith('.env.example'))return 'environment file';
  if(/(^|\/)\.dev\.vars(?:\.|$)/i.test(value)&&!value.endsWith('.dev.vars.example'))return 'Worker credentials';
  if(/\.(?:dump(?:\..*)?|sqlite3?|db|pem|key|ppk|p12|pfx|docx?|xlsx?|pdf|zip|7z|tar(?:\.gz)?)$/i.test(value))return 'private data/key/archive';
  if(/(^|\/)(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:-sk)?|authorized_keys|known_hosts|vps-access(?:\.[^/]*)?|admin-accounts(?:\.[^/]*)?|seed-state(?:\.[^/]*)?)$/i.test(value))return 'private access file';
  if(/[\r\n\x00]/.test(value))return 'unsafe filename';
  return null;
}
export function checkContent(content) {
  const rules=[
    ['private key',/-----BEGIN (?:(?:OPENSSH |RSA |DSA |EC |ENCRYPTED )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----|PuTTY-User-Key-File-\d+:/],
    ['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
    ['AWS access key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
    ['credential literal',/\b(?:root[_-]?Password|admin[_-]?Password|access[_-]?token|refresh[_-]?token|api[_-]?key|secret[_-]?key|client[_-]?secret|(?:CLOUDFLARE|CF)_API_TOKEN|GITHUB_TOKEN)["']?\s*[:=]\s*["'](?!unused|example|placeholder|REPLACE_ME|process\.env)[^"'\r\n]{8,}["']/i],
    ['credential in URL',/(?:https?|postgres(?:ql)?|mysql|redis|amqps?|ssh|ftp):\/\/[^\s/:@]+:[^\s/@]{6,}@/],
  ];
  const lines=content.split('\n');
  return rules.flatMap(([name,pattern])=>lines.flatMap((line,index)=>pattern.test(line)?[{rule:name,line:index+1}]:[]));
}
function git(args,options={}){const r=spawnSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024,...options});if(r.status!==0)throw new Error('Git inventory failed');return r.stdout;}
export function scan(staged=false) {
  const paths=git(staged?['diff','--cached','--name-only','--diff-filter=ACMR','-z']:['ls-tree','-r','--name-only','-z','HEAD']).split('\0').filter(Boolean);
  const findings=[];
  for(const path of paths){
    const reason=checkPath(path);if(reason){findings.push({path,rule:reason});continue;}
    const reference=`${staged?':':'HEAD:'}${path}`;
    const asset=/^public\/.*\.(?:ttf|otf|woff2?|png|jpe?g|gif|webp|ico)$/i.test(path);
    const size=Number(git(['cat-file','-s',reference]).trim());
    if(!Number.isSafeInteger(size)||size>(asset?24:8)*1024*1024){findings.push({path,rule:'file exceeds safe scan size'});continue;}
    const raw=git(['cat-file','blob',reference],{encoding:'buffer'});
    let content;
    try{content=asset?raw.toString('latin1'):new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{findings.push({path,rule:'unrecognized binary file'});continue;}
    if(!asset&&raw.includes(0)){findings.push({path,rule:'unrecognized binary file'});continue;}
    findings.push(...checkContent(content).map(match=>({path,...match})));
  }
  if(findings.length){for(const finding of findings)console.error(`${finding.path}${finding.line?':'+finding.line:''}: ${finding.rule}`);throw new Error('Commit blocked: private data or credentials found. No secret values are printed.');}
  console.log(`Secret guard: ${paths.length} files checked.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{scan(process.argv.includes('--staged'));}catch(error){console.error(error.message);process.exitCode=1;}}
