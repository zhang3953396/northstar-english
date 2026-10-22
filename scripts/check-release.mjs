import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const allowed=[
  '.gitignore','LICENSE','README.md','package.json','server.mjs',
  ...['storage','review-engine','animation-curriculum','speaking-progress','learning-results','rewards'].map(name=>'core/'+name+'.js'),
  'adapters/tencent-soe.js','demo/index.html','demo/style.css','demo/app.js','demo/lessons.js',
  'docs/ARCHITECTURE.md','docs/source-provenance.json','tests/core.test.mjs','tests/server.test.mjs','scripts/check-release.mjs'
];
function walk(dir,prefix=''){
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const name=prefix+entry.name;
    if(entry.name==='.git')return[];
    if(entry.isSymbolicLink())throw new Error('Symlink rejected: '+name);
    return entry.isDirectory()?walk(path.join(dir,entry.name),name+'/'):[name];
  });
}
const actual=walk(root).sort();
if(JSON.stringify(actual)!==JSON.stringify(allowed.sort()))throw new Error('Public release file inventory differs from reviewed whitelist');
for(const name of actual){
  const text=fs.readFileSync(path.join(root,name),'utf8');
  // Never print matching values.
  if(/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKID[A-Za-z0-9]{16,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bsk-[A-Za-z0-9_-]{24,}\b/.test(text))throw new Error('Possible credential in '+name);
  if(/\/(?:Users|Volumes|home)\//.test(text))throw new Error('Private-environment reference in '+name);
  if(/\.(?:mp4|mp3|wav|pdf|pem|p12)$/i.test(name))throw new Error('Unreviewed media or credential file: '+name);
  if(/\.(?:js|mjs)$/.test(name))execFileSync(process.execPath,['--check',path.join(root,name)],{stdio:'pipe'});
}
console.log('Reviewed public release: '+actual.length+' text files; credential, private-path, media and syntax checks passed.');
