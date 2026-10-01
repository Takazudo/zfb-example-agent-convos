import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const target=resolve(root,'apps/showcase/components/shared');rmSync(target,{recursive:true,force:true});mkdirSync(target,{recursive:true});
// The compiler sees a fully project-local tree. No ../../ imports escape the zfb project root.
// Explicit allowlist, not a copy of all server sources: private adapters cannot enter the public bundle.
const allowed=['packages/core/src','packages/controller/src','packages/mock/src'];
const files=['packages/client/src/port.ts','packages/client/src/wire.ts','workers/conversations/src/execution.ts'];
for(const dir of allowed)for(const name of readdirSync(resolve(root,dir)))if(name.endsWith('.ts'))files.push(`${dir}/${name}`);
for(const name of files){const path=resolve(target,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,readFileSync(resolve(root,name),'utf8').replace(/(from\s+['"][^'"]+)\.js(['"])/g,'$1$2'));}
mkdirSync(resolve(root,'apps/showcase/public'),{recursive:true});copyFileSync(resolve(root,'packages/workbench/src/styles.css'),resolve(root,'apps/showcase/public/convos.css'));
// Assert known forbidden modules are absent. Import closure is also checked in check-source.mjs.
for(const name of files){const text=readFileSync(resolve(root,name),'utf8');if(/from ['"][^'"]*(?:http-handler|d1-repository|node:|client\/src\/http)/.test(text))throw Error(`Private dependency in mock graph: ${name}`);}
console.log(`Staged ${files.length} public mock sources under ${relative(root,target)}; authored CSS copied.`);
