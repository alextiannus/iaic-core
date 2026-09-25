import {readFile} from 'node:fs/promises';
const fail=statusCode=>Object.assign(Error('Dashboard request rejected'),{statusCode});
const headers={'Cache-Control':'no-store, private','Vary':'Cookie, Authorization','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
/** Optional Node HTTP mount. Host supplies current session/operator authority. */
export function createOperationsDashboard({operations,resolveObserver,authorizeOperator,basePath='/admin/agents'}) {
 if(!operations||typeof operations.overview!=='function'||typeof operations.agent!=='function'||typeof resolveObserver!=='function'||typeof authorizeOperator!=='function')throw Error('Dashboard requires Operations and trusted current observer/operator ports');
 if(typeof basePath!=='string'||!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(basePath))throw Error('Invalid dashboard basePath');
 const assets=new Map([['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
 const guard=async request=>{const observer=await resolveObserver(request);if(!observer||observer.actor==null)throw fail(401);if(typeof observer.binding!=='string'||!observer.binding||observer.binding.length>2000)throw fail(403);if(await authorizeOperator({actor:observer.actor,request})!==true)throw fail(403);return observer;};
 return async function dashboard(request,response) {
  let url;try{if(!request.url?.startsWith('/'))return false;url=new URL(request.url,'http://local.invalid');}catch{return false;}
  if(url.pathname!==basePath&&!url.pathname.startsWith(basePath+'/'))return false;
  const send=(status,type,body)=>{response.writeHead(status,{...headers,'Content-Type':type});response.end(body);};
  try {
   const observer=await guard(request);
   if(request.method!=='GET')throw fail(405);
   const path=url.pathname.slice(basePath.length);let body,type='application/json; charset=utf-8';
   if(path===''||path==='/') {type='text/html; charset=utf-8';body=(await readFile(new URL('./ui/index.html',import.meta.url),'utf8')).replaceAll('__BASE__',basePath);}
   else if(assets.has(path)){const [file,mime]=assets.get(path);type=mime;body=await readFile(new URL('./ui/'+file,import.meta.url));}
   else if(path==='/api/overview') {
    for(const key of url.searchParams.keys())if(!['cursor','limit'].includes(key)||url.searchParams.getAll(key).length!==1)throw fail(400);
    const input={};if(url.searchParams.has('cursor'))input.cursor=url.searchParams.get('cursor');if(url.searchParams.has('limit')){const value=url.searchParams.get('limit');if(!/^[1-9][0-9]*$/.test(value))throw fail(400);input.limit=Number(value);}
    body=JSON.stringify(await operations.overview(observer.actor,input));
   } else if(path==='/api/agent') {
    if([...url.searchParams.keys()].some(k=>k!=='id')||url.searchParams.getAll('id').length!==1||!url.searchParams.get('id'))throw fail(400);
    body=JSON.stringify(await operations.agent(observer.actor,url.searchParams.get('id')));
   } else throw fail(404);
   const current=await guard(request);if(current.binding!==observer.binding)throw fail(403);
   send(200,type,body);
  } catch(error) {const status=[400,401,403,404,405,502,504].includes(error?.statusCode)?error.statusCode:500;send(status,'application/json; charset=utf-8',JSON.stringify({error:{code:({400:'INVALID_REQUEST',401:'LOGIN_REQUIRED',403:'OPERATIONS_ACCESS_DENIED',404:'NOT_FOUND',405:'METHOD_NOT_ALLOWED',502:'SOURCE_UNAVAILABLE',504:'SOURCE_TIMEOUT'})[status]??'OPERATIONS_UNAVAILABLE'}}));}
  return true;
 };
}
