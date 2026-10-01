/** Offline syntax/import-closure checks only; this is deliberately not a zfb or SDK type check. */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));process.chdir(root);
const require=createRequire(import.meta.url);let ts;try{ts=require('typescript');}catch{ts=require(resolve(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript'));}
const app=resolve(root,'apps/showcase');const visited=new Set(),externals=new Set(),errors=[];
function findTarget(from, specifier){const bare=resolve(dirname(from),specifier);const candidates=[bare,bare.replace(/\.js$/,'.ts'),bare+'.ts',bare+'.tsx',bare+'/index.ts'];return candidates.find(existsSync);}
function visit(path){if(visited.has(path))return;visited.add(path);const source=readFileSync(path,'utf8');
 const output=ts.transpileModule(source,{fileName:path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'@takazudo/zfb/zudo-react'},reportDiagnostics:true});
 for(const d of output.diagnostics??[])if(d.category===ts.DiagnosticCategory.Error)errors.push(ts.flattenDiagnosticMessageText(d.messageText,' '));
 const file=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 for(const statement of file.statements){if(!(ts.isImportDeclaration(statement)||ts.isExportDeclaration(statement))||!statement.moduleSpecifier||!ts.isStringLiteral(statement.moduleSpecifier))continue;
  const spec=statement.moduleSpecifier.text;
  if(!spec.startsWith('.')){externals.add(spec);continue;}
  const target=findTarget(path,spec);if(!target){errors.push('Unresolved '+spec+' in '+path);continue;}
  if(!target.startsWith(app+'/')){errors.push('Import escapes showcase root: '+target);continue;}
  if(/(?:d1-repository|http-handler|client\/src\/http|node:)/.test(target))errors.push('Private module in public source graph: '+target);
  visit(target);
 }
}
for(const file of ['pages/index.tsx','layouts/default.tsx','zfb.config.ts'])visit(resolve(app,file));
for(const spec of externals)if(!spec.startsWith('@takazudo/zfb'))errors.push('Unexpected dependency '+spec);
const report={kind:'offline-syntax-and-public-import-closure',typescript:ts.version,files:[...visited].map(f=>relative(root,f)),externals:[...externals],errors,zfbSdkTypecheck:'NOT RUN',zfbBuild:'NOT RUN',hydration:'NOT RUN'};
mkdirSync('evidence',{recursive:true});writeFileSync('evidence/showcase-source-check.json',JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log(`${visited.size} source files: syntax and public import closure checked. SDK types/build/hydration NOT verified.`);
