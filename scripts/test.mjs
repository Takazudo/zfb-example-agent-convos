import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));process.chdir(root);
process.env.PATH=resolve(root,'node_modules/.bin')+delimiter+process.env.PATH;
function run(command,args){const r=spawnSync(command,args,{stdio:'inherit'});if(r.error){console.error(r.error.message);process.exit(1);}if(r.status!==0)process.exit(r.status??1);}
run('tsc',['-p','tsconfig.core.json']);
run(process.execPath,['scripts/build-workbench.mjs']);
run(process.execPath,['scripts/stage-showcase.mjs']);
run(process.execPath,['scripts/check-source.mjs']);
const tests=['tests/unit','tests/contract'].flatMap(dir=>readdirSync(dir).filter(f=>f.endsWith('.test.mjs')).map(f=>`${dir}/${f}`));
run(process.execPath,['--test',...tests]);
console.log('Offline source/core/HTTP/SQLite gates passed. zfb/Cloudflare and browser gates are separate.');
