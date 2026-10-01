/** Full gate: intentionally fails when the real toolchain or direct browser checks are unavailable. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
function run(cmd,args,env=process.env){const r=spawnSync(cmd,args,{stdio:'inherit',env});if(r.error||r.status!==0)process.exit(r.status??1);}
run(process.execPath,['scripts/verify-zfb.mjs']);
if(!existsSync('pnpm-lock.yaml')){console.error('BLOCKED: generate and review pnpm-lock.yaml after a successful real install.');process.exit(1);}
run(process.execPath,['scripts/test.mjs']);
run('pnpm',['--dir','apps/showcase','check']);run('pnpm',['--dir','apps/showcase','build']);
run('pnpm',['--dir','apps/local','check']);run('pnpm',['--dir','apps/local','build']);
run(process.execPath,['scripts/check-public-build.mjs']);
run(process.env.PYTHON ?? 'python3',['tests/browser/smoke.py'],{...process.env,CONVOS_BROWSER_DIRECT:'1'});
run(process.env.PYTHON ?? 'python3',['tests/browser/zfb_smoke.py']);
