import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
mkdirSync('build',{recursive:true}); mkdirSync('artifacts',{recursive:true});
const mock=JSON.parse(readFileSync('tsconfig.workbench.json','utf8'));
const http={...mock,compilerOptions:{...mock.compilerOptions,outFile:'build/workbench-http.js'},files:['dev/http-entry.ts']};
writeFileSync('tsconfig.workbench-http.json',JSON.stringify(http,null,2)+'\n');
for(const config of ['tsconfig.workbench.json','tsconfig.workbench-http.json']){
 const r=spawnSync('tsc',['-p',config],{stdio:'inherit'}); if(r.status!==0)process.exit(r.status??1);
}
const css=readFileSync('packages/workbench/src/styles.css','utf8');const loader=readFileSync('scripts/amd-loader.js','utf8');
for(const kind of ['mock','http']){
 const script=loader+'\n'+readFileSync(`build/workbench-${kind}.js`,'utf8')+`\nstartConvosWorkbench('dev/${kind}-entry').catch?.(error => { console.error(error); document.getElementById('app').textContent = 'Unable to start workbench. Open this file in a modern browser with Web Crypto, or use the loopback server.'; });`;
 // HTTP start returns an object rather than a promise. Avoid optional access on undefined.
 const safeScript=script.replace(/<\/script/gi,'<\\/script');
 writeFileSync(`artifacts/workbench-${kind}.html`,`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Agent conversations — ${kind==='mock'?'mock':'local SQLite'} workbench</title><style>${css}</style></head><body><div id="app">Starting workbench…</div><noscript>This developer workbench requires JavaScript.</noscript><script>${safeScript}</script></body></html>`);
}
console.log('Built isolated mock and HTTP workbench artifacts. This is not a zfb build.');
