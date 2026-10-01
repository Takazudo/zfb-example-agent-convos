/** Loopback-only fake-provider development server. Not a Cloudflare deploy entry. */
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteAdapter } from './sqlite.mjs';
import { SqliteHostStore } from './sqlite-host.mjs';
import { D1Repository } from '../build/workers/conversations/src/d1-repository.js';
import { createHandler } from '../build/workers/conversations/src/http-handler.js';
import { DemoHost } from '../build/packages/mock/src/demo-host.js';
import { createLab } from '../build/packages/mock/src/lab.js';
import { realClock } from '../build/packages/core/src/service.js';
const root=fileURLToPath(new URL('..',import.meta.url));
const port=Number(process.env.PORT??8787);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT must be an integer from 1024 to 65535.');
const dbPath=resolve(root,process.env.CONVOS_DB??'.dev-state/conversations.sqlite');
await mkdir(dirname(dbPath),{recursive:true,mode:0o700});
const adapter=new SqliteAdapter(dbPath);const host=new DemoHost(new SqliteHostStore(adapter));
const lab=await createLab({repository:new D1Repository(adapter),host,clock:realClock});
const unwrap=r=>{if(!r.ok)throw Error(r.error.message);return r.value;};
if(!unwrap(await lab.client.list({})).items.length){
 for(const title of ['Inquiry email address','Company information'])unwrap(await lab.client.create({title},{requestKey:realClock.id('seed')}));
 const c=unwrap(await lab.client.create({title:'October release page'},{requestKey:realClock.id('seed')}));
 unwrap(await lab.client.send(c.id,{text:'Create an October release page. Keep it as a draft.',expectedRevision:c.revision},{requestKey:realClock.id('seed')}));
 await lab.pump();
}
lab.provider.delayMs=200;
const handler=createHandler({resolvePrincipal:async()=>lab.principal,client:()=>lab.client});
const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
let stopping=false,pumping=null;
async function sweep(){
 if(stopping||pumping)return;
 pumping=(async()=>{await lab.repository.repair(new Date().toISOString());await lab.pump();})();
 try{await pumping;}catch{console.error('Local fake-worker pass failed; durable work remains eligible for repair.');}finally{pumping=null;}
}
const timer=setInterval(()=>void sweep(),300);timer.unref();
const server=createServer(async(req,res)=>{
 try{
  if(!allowedHosts.has(req.headers.host??'')||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end('Loopback development access only.');return;}
  const origin=`http://${req.headers.host}`;
  if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403);res.end('Cross-origin access denied.');return;}
  const url=new URL(req.url,origin);
  if(url.pathname==='/health'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({ok:true,mode:'local-sqlite',provider:'fake',cloudflare:false}));return;}
  if(url.pathname.startsWith('/api/v1/')){
   const request=new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});
   const response=await handler(request);res.writeHead(response.status,Object.fromEntries(response.headers));
   if(response.body)for await(const chunk of response.body)res.write(chunk);res.end();return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  if(url.pathname==='/__dev/host'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(await host.inspect(lab.principal,'fixture')));return;}
  const files=new Map([['/','apps/local/dist/index.html'],['/mock','apps/showcase/dist/index.html'],['/workbench','artifacts/workbench-http.html'],['/workbench/mock','artifacts/workbench-mock.html'],['/reference','reference/prototype.html']]);
  let file=files.get(url.pathname);
  if (/^\/assets\/[A-Za-z0-9_.-]+$/.test(url.pathname) || url.pathname==='/convos.css') {
   // Both builds use content-hashed assets. Fall through only on a missing local file.
   for (const dir of ['apps/local/dist','apps/showcase/dist']) {
    try { await readFile(resolve(root,dir,'.'+url.pathname)); file=dir+url.pathname; break; } catch(error) { if(error.code!=='ENOENT')throw error; }
   }
  }
  if(!file){res.writeHead(404);res.end('Not found');return;}
  const content=await readFile(resolve(root,file));
  res.writeHead(200,{'Content-Type':({'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8'}[extname(file)]??'application/octet-stream'),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'"});
  res.end(req.method==='HEAD'?undefined:content);
 }catch{if(!res.headersSent)res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Local development request failed.'}));}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local SQLite + fake provider: http://127.0.0.1:${port}\nMemory-only workbench: http://127.0.0.1:${port}/mock\nNo live model calls, Cloudflare resources, or public network listener.`));
async function shutdown(){if(stopping)return;stopping=true;clearInterval(timer);server.close();if(pumping)await pumping.catch(()=>{});server.closeAllConnections();adapter.close();}
process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
