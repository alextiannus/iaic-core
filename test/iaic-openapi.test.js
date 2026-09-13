import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {once} from 'node:events';
import {OpenApiCatalog,importHttpCapabilities,CapabilityDispatcher} from '@immedi/iaic-core';
const object={type:'object'},document=()=>({openapi:'3.0.4',info:{title:'Fixture',version:'1'},servers:[{url:'https://unapproved.invalid'}],paths:{'/items/{id}':{parameters:[{$ref:'#/components/parameters/id'}],get:{operationId:'readItem',parameters:[{name:'verbose',in:'query',schema:{type:'boolean'}}],responses:{200:{description:'Found',content:{'application/json':{schema:object}}}}}},'/items':{post:{operationId:'writeItem',requestBody:{required:true,content:{'application/json':{schema:object}}},responses:{201:{description:'Created'}}}}},components:{parameters:{id:{in:'path',name:'id',required:true,schema:{type:'string'}}}}});
test('Discovered operation mappings call only the selected host endpoint and retain live authorization',async()=>{
 let observed;const server=createServer((req,res)=>{observed={url:req.url,method:req.method,authorization:req.headers.authorization};res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true}));});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const doc=document(),catalog=new OpenApiCatalog({document:doc});doc.paths['/items/{id}'].get.operationId='changed';assert.equal(catalog.list()[0].id,'readItem');assert.equal(catalog.get('readItem').parameters[0].schema.type,'string');
  let allowed=true;const bindings=catalog.bindings([{operationId:'readItem',name:'remote.item.read',effect:'read',input:{type:'object',properties:{path:object,query:object},required:['path'],additionalProperties:false},output:object,authorize:()=>allowed,revalidate:async(_i,r)=>r}]);
  const dispatcher=new CapabilityDispatcher({capabilities:importHttpCapabilities({baseUrl:`http://127.0.0.1:${server.address().port}/api/`,bindings,resolveHeaders:()=>({authorization:'Bearer fixture'})})});
  const result=await dispatcher.invoke('remote.item.read',{path:{id:'a/b'},query:{verbose:false}},{actor:{subjectId:'fixture'}});assert.equal(result.ok,true);assert.deepEqual(observed,{url:'/api/items/a%2Fb?verbose=false',method:'GET',authorization:'Bearer fixture'});
  allowed=false;await assert.rejects(dispatcher.invoke('remote.item.read',{path:{id:'a'}},{actor:{subjectId:'fixture'}}),{statusCode:403});
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('JSON body mapping requires host schemas, effect policy and declared argument groups',()=>{
 const catalog=new OpenApiCatalog({document:document()});assert.throws(()=>catalog.bindings([{operationId:'writeItem'}]));
 const [write]=catalog.bindings([{operationId:'writeItem',name:'remote.item.write',effect:'write',authorize:()=>true,input:object,output:object}]);assert.deepEqual(write.request({body:{name:'draft'}}),{path:'items',query:Object.create(null),body:{name:'draft'}});assert.throws(()=>write.request({}));assert.throws(()=>write.request({headers:{authorization:'model-selected'}}));
 const [read]=catalog.bindings([{operationId:'readItem',name:'remote.item.read',effect:'read',authorize:()=>true,input:object,output:object}]);for(const value of [{path:{id:'..'}},{path:{id:'a'},query:{unknown:'b'}},{path:{id:'a'},query:{verbose:'false'}},{path:{id:'a'},body:{}}])assert.throws(()=>read.request(value));
});
test('Discovery rejects ambiguous, recursive and remote references and unsupported serialization',()=>{
 const remote=document();remote.paths['/items/{id}'].parameters=[{$ref:'https://unapproved.invalid/parameter'}];assert.throws(()=>new OpenApiCatalog({document:remote}),/local references/);
 const recursive=document();recursive.components.parameters.id={$ref:'#/components/parameters/id'};assert.throws(()=>new OpenApiCatalog({document:recursive}),/nonrecursive/);
 const duplicate=document();duplicate.paths['/items'].post.operationId='readItem';assert.throws(()=>new OpenApiCatalog({document:duplicate}),/Unique/);
 const arrays=document();arrays.paths['/items/{id}'].get.parameters[0].schema={type:'array',items:{type:'string'}};const catalog=new OpenApiCatalog({document:arrays});assert.throws(()=>catalog.bindings([{operationId:'readItem',name:'remote.read',effect:'read',authorize:()=>true,input:object,output:object}]),/scalar/);
 const sibling=document();sibling.components.parameters.id={$ref:'#/components/parameters/other',description:'Sibling'};assert.throws(()=>new OpenApiCatalog({document:sibling}),/siblings/);
});
