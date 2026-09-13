import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {CapabilityDispatcher, importHttpCapabilities} from '@immedi/iaic-core';

const input = {type: 'object', properties: {value: {type: 'string'}}, required: ['value'], additionalProperties: false};
const actor = {subjectId: 'owner'};
test('Imported JSON API uses actual HTTP, current credentials and remote stable keys', async () => {
  const records = new Map(); let writes = 0, credential = 'Bearer first';
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== credential) {res.writeHead(401);res.end();return;}
    if (req.method === 'GET') {res.setHeader('content-type','application/json');res.end(JSON.stringify({value: new URL(req.url, 'http://local').searchParams.get('value')}));return;}
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const key = req.headers['idempotency-key'];
    if (!records.has(key)) {records.set(key, body); writes++;}
    res.setHeader('content-type','application/json');res.end(JSON.stringify(records.get(key)));
  });
  server.listen(0, '127.0.0.1');await once(server, 'listening');
  try {
    let allowed = true;
    const caps = importHttpCapabilities({baseUrl: `http://127.0.0.1:${server.address().port}/api/`, resolveHeaders: async ({actor: current}) => {assert.equal(current.subjectId,'owner');return {authorization: credential};}, bindings: [
      {name:'remote.read', description:'Read', input, output:input, effect:'read', authorize:()=>allowed, request:value=>({path:'record',query:value})},
      {name:'remote.write',description:'Write',input,output:input,effect:'write',retry:'idempotent',idempotencyHeader:'Idempotency-Key',method:'POST',authorize:()=>allowed,request:value=>({path:'record',body:value})}
    ]});
    const dispatcher = new CapabilityDispatcher({capabilities:caps});
    assert.deepEqual(await dispatcher.invoke('remote.read',{value:'first'},{actor}),{value:'first'});
    credential = 'Bearer rotated';
    await dispatcher.invoke('remote.write',{value:'saved'},{actor,callId:'stable'});
    await dispatcher.invoke('remote.write',{value:'saved'},{actor,callId:'stable'});
    assert.equal(writes,1);
    allowed = false;
    await assert.rejects(dispatcher.invoke('remote.write',{value:'other'},{actor,callId:'new'}),{statusCode:403});assert.equal(writes,1);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('HTTP imports retain unknown writes and do not replay or follow destination changes', async () => {
  let calls = 0;
  const binding = {name:'remote.write',description:'Write',input,output:input,effect:'write',method:'POST',authorize:()=>true,request:value=>({path:'record',body:value})};
  const create = (request, fetch) => new CapabilityDispatcher({capabilities:importHttpCapabilities({baseUrl:'https://example.test/api/',resolveHeaders:()=>({}),fetch,bindings:[{...binding,request}]})});
  await assert.rejects(create(binding.request,async()=>{calls++;throw new Error('network secret');}).invoke('remote.write',{value:'x'},{actor,callId:'original'}),error=>error.outcomeUnknown===true&&!error.message.includes('secret'));
  assert.equal(calls,1);
  await assert.rejects(create(()=>({path:'https://other.test/api/'}),async()=>{calls++;}).invoke('remote.write',{value:'x'},{actor,callId:'original'}),{statusCode:400});assert.equal(calls,1);
  await assert.rejects(create(()=>({path:'../outside'}),async()=>{calls++;}).invoke('remote.write',{value:'x'},{actor,callId:'original'}),{statusCode:400});assert.equal(calls,1);
  await assert.rejects(create(binding.request,async(_url,options)=>{assert.equal(options.redirect,'error');return new Response('private backend message',{status:500});}).invoke('remote.write',{value:'x'},{actor,callId:'original'}),error=>error.outcomeUnknown&&!error.message.includes('private'));
});

test('HTTP result projection is schema-checked and timed-out writes remain unknown', async () => {
  const base = {baseUrl:'https://example.test/api/',resolveHeaders:()=>({})};
  const binding = {name:'remote.write',description:'Write',input,output:input,effect:'write',method:'POST',authorize:()=>true,request:value=>({path:'record',body:value})};
  const dispatcher = new CapabilityDispatcher({capabilities:importHttpCapabilities({...base,fetch:async()=>Response.json({wrapped:{value:'projected'}}),bindings:[{...binding,project:body=>body.wrapped}]})});
  assert.deepEqual(await dispatcher.invoke('remote.write',{value:'x'},{actor,callId:'project'}),{value:'projected'});
  const bad = new CapabilityDispatcher({capabilities:importHttpCapabilities({...base,fetch:async()=>Response.json({value:42}),bindings:[binding]})});
  await assert.rejects(bad.invoke('remote.write',{value:'x'},{actor,callId:'invalid'}),{statusCode:502,outcomeUnknown:true});
  const timed = new CapabilityDispatcher({capabilities:importHttpCapabilities({...base,timeoutMs:10,fetch:async(_url,{signal})=>new Promise((_resolve,reject)=>{const keepAlive=setTimeout(()=>reject(new Error('fixture did not abort')),1000);signal.addEventListener('abort',()=>{clearTimeout(keepAlive);reject(signal.reason);},{once:true});}),bindings:[binding]})});
  await assert.rejects(timed.invoke('remote.write',{value:'x'},{actor,callId:'timeout'}),{statusCode:502,outcomeUnknown:true});
});
