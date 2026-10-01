import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const app=fileURLToPath(new URL('../apps/showcase',import.meta.url));
for(const name of ['zfb','zfb-runtime']){
 const path=resolve(app,'node_modules/@takazudo',name,'package.json');
 if(!existsSync(path)){console.error(`BLOCKED: @takazudo/${name}@3.0.0 is not installed under apps/showcase. Resolve pnpm install and commit its lockfile locally; this is not a passed gate.`);process.exit(1);}
 const pkg=JSON.parse(readFileSync(path,'utf8'));if(pkg.version!=='3.0.0')throw Error(`Expected ${name}@3.0.0; got ${pkg.version}. Do not silently float the baseline.`);
}
const bin=resolve(app,'node_modules/@takazudo/zfb/bin/zfb.mjs');
const r=spawnSync(process.execPath,[bin,'--version'],{cwd:app,encoding:'utf8'});
process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');
if(r.status!==0||!/(?:^|\s)3\.0\.0(?:\s|$)/.test(r.stdout??'')){console.error('BLOCKED: matching executable could not be confirmed.');process.exit(1);}
console.log('Installed SDK, runtime and binary identify as 3.0.0. Actual build and browser checks remain required.');
