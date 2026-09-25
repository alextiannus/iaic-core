import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createOperationsDashboard} from '../operations/dashboard.js';
async function fixture(run) {
 const state={permitted:true,binding:'session-1',reads:0,afterRead:()=>{}};
 const handler=createOperationsDashboard({basePath:'/ops/agents',resolveObserver:async req=>req.headers.authorization?{actor:{kind:req.headers.authorization},binding:state.binding}:null,authorizeOperator:({actor})=>state.permitted&&actor.kind==='operator',operations:{overview:async()=>{state.reads++;state.afterRead();return {items:[],secret:'authorized payload'};},agent:async(_actor,id)=>{state.reads++;return {id};}}});
 const server=createServer((req,res)=>{handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}}).catch(error=>{res.destroy(error);});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{await run({state,base,get:(path,role='operator',options={})=>fetch(base+path,{...options,headers:role?{authorization:role}:{}})});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('dashboard checks operator access on page, assets and data; organization admin is not operator',()=>fixture(async({state,get})=>{
 for(const path of ['/ops/agents','/ops/agents/app.js','/ops/agents/style.css','/ops/agents/api/overview','/ops/agents/api/agent?id=a']){
  for(const role of [null,'user','organization-admin']){const r=await get(path,role);assert.equal(r.status,role?403:401);assert.match(r.headers.get('cache-control'),/no-store/);}
 }
 assert.equal(state.reads,0);const page=await get('/ops/agents');assert.equal(page.status,200);assert.match(await page.text(),/\/ops\/agents\/app.js/);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.equal((await get('/ops/agents/api/overview')).status,200);assert.equal((await get('/ops/agents/api/agent?id=a')).status,200);assert.equal(state.reads,2);
}));
test('revocation or session replacement during a read suppresses already prepared data',()=>fixture(async({state,get})=>{
 state.afterRead=()=>{state.permitted=false;};let r=await get('/ops/agents/api/overview');assert.equal(r.status,403);assert.doesNotMatch(await r.text(),/authorized payload/);
 state.permitted=true;state.afterRead=()=>{state.binding='session-2';};r=await get('/ops/agents/api/overview');assert.equal(r.status,403);assert.doesNotMatch(await r.text(),/authorized payload/);
}));
test('dashboard only handles its mount, only reads, and rejects ambiguous query input',()=>fixture(async({state,get})=>{
 for(const path of ['/ops/agents/api/overview?limit=2&limit=3','/ops/agents/api/overview?other=x','/ops/agents/api/overview?limit=2e1','/ops/agents/api/agent?id=a&id=b','/ops/agents/api/agent'])assert.equal((await get(path)).status,400);
 assert.equal((await get('/ops/agents/api/overview','operator',{method:'POST'})).status,405);assert.equal(state.reads,0);
 assert.equal((await get('/ops/agents-other')).status,404);assert.equal((await get('/ops/agents/unknown')).status,404);
}));
test('dashboard reports source errors without private exception text',async()=>{
 const handler=createOperationsDashboard({resolveObserver:async()=>({actor:{},binding:'s'}),authorizeOperator:()=>true,operations:{overview:async()=>{throw Error('credential-secret');},agent:async()=>({})}});
 let status,body;await handler({url:'/admin/agents/api/overview',method:'GET'},{writeHead:s=>{status=s;},end:s=>{body=s;}});assert.equal(status,500);assert.doesNotMatch(body,/credential-secret/);
 assert.throws(()=>createOperationsDashboard({basePath:'/bad"',operations:{overview(){},agent(){}},resolveObserver:async()=>null,authorizeOperator:()=>true}));
});
test('optional feedback needs mutation authority, bounded input and existing Agent access',async()=>{
 let allowed=true,writes=0;
 const handler=createOperationsDashboard({refreshMs:5000,resolveObserver:async()=>({actor:{},binding:'session'}),authorizeOperator:()=>allowed,authorizeMutation:({request})=>request.headers['x-iaic-operations']==='1',operations:{overview:async()=>({}),agent:async(_a,id)=>{if(id!=='a')throw Object.assign(Error('hidden'),{statusCode:403});return {};}},
 feedback:{list:async()=>[],report:async(_a,input)=>{writes++;return{id:input.requestKey,state:'reported',summary:input.summary};}}});
 const server=createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/admin/agents/api/';
 try{
  assert.deepEqual(await(await fetch(base+'config')).json(),{refreshMs:5000,feedback:true});
  const input={requestKey:'1234567890123456',summary:'executor stale'},post=(id,headers={})=>fetch(base+'feedback?id='+id,{method:'POST',headers,body:JSON.stringify(input)});
  assert.equal((await post('a')).status,403);assert.equal((await post('hidden',{'x-iaic-operations':'1'})).status,403);assert.equal(writes,0);
  assert.equal((await post('a',{'x-iaic-operations':'1'})).status,200);assert.equal(writes,1);
  allowed=false;assert.equal((await post('a',{'x-iaic-operations':'1'})).status,403);assert.equal(writes,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
