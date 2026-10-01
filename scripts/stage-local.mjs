// Separate local-only build graph; never imported by the public showcase.
import './stage-showcase.mjs';
import { cpSync, copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
mkdirSync('apps/local', {recursive:true});
for (const name of ['components','pages','layouts','public']) {
    rmSync(`apps/local/${name}`, {recursive:true,force:true});
    cpSync(`apps/showcase/${name}`, `apps/local/${name}`, {recursive:true});
}
for (const name of ['tsconfig.json','zfb.config.ts']) copyFileSync(`apps/showcase/${name}`,`apps/local/${name}`);
copyFileSync('dev/zfb-session.ts','apps/local/components/session.ts');
const file='packages/client/src/http.ts';
writeFileSync(`apps/local/components/shared/${file}`,readFileSync(file,'utf8').replace(/(from\s+['"][^'"]+)\.js(['"])/g,'$1$2'));
console.log('Staged isolated local HTTP UI from the shared zudo-react components.');
