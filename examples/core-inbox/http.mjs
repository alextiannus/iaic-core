import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import {actor} from './application.mjs';
export async function serveDemo(app) {
 const token=randomBytes(32).toString('hex');let origin;
 const html=(await fs.readFile(new URL('./index.html',import.meta.url),'utf8')).replace('__TOKEN__',token);
 const server=createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');
  try {
   if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)){res.writeHead(403).end();return;}
   if(req.method==='GET'&&req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end(html);return;}
   if(req.method!=='POST'||req.url!=='/api'||req.headers.authorization!=='Bearer '+token||!req.headers['content-type']?.startsWith('application/json')){res.writeHead(403).end();return;}
   const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>8192){res.writeHead(413).end();return;}chunks.push(c);}
   const {name,input={}}=JSON.parse(Buffer.concat(chunks).toString());let result;
   if(name==='demo.timeline') {
    const page=await app.sessions.read(app.sessionScope,app.session.id);
    result=await app.timeline.context(actor,{id:app.session.id,throughSequence:page.throughSequence});
   } else result=await app.invoke(name,input);
   res.setHeader('content-type','application/json');res.end(JSON.stringify({result}));
  } catch(error){res.writeHead(error.statusCode||500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.statusCode?error.message:'Request failed'}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 return {origin,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
