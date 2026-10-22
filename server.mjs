import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
export const publicPaths = new Map([
  ['/', ['demo/index.html','text/html; charset=utf-8']],
  ['/demo/style.css',['demo/style.css','text/css; charset=utf-8']],
  ['/demo/app.js',['demo/app.js','text/javascript; charset=utf-8']],
  ['/demo/lessons.js',['demo/lessons.js','text/javascript; charset=utf-8']],
  ...['storage','review-engine','speaking-progress','learning-results','animation-curriculum','rewards'].map(name => ['/core/'+name+'.js',['core/'+name+'.js','text/javascript; charset=utf-8']])
]);
export async function handleRequest(req,res) {
    let pathname;
    try { pathname = new URL(req.url,'http://localhost').pathname; } catch { res.writeHead(400).end(); return; }
    const item = publicPaths.get(pathname);
    if (!['GET','HEAD'].includes(req.method) || !item) { res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}).end('Not found'); return; }
    try {
      const data=await readFile(path.join(root,item[0]));
      res.writeHead(200,{'Content-Type':item[1],'X-Content-Type-Options':'nosniff','Cache-Control':'no-store',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        'Permissions-Policy':'microphone=(), camera=(), geolocation=()'});
      res.end(req.method==='HEAD'?undefined:data);
    } catch { res.writeHead(500).end('Unable to read public file'); }
}
export function createServer() {
  return http.createServer(handleRequest);
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||18731);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
  createServer().listen(port,'127.0.0.1',()=>console.log('Northstar: http://127.0.0.1:'+port));
}
