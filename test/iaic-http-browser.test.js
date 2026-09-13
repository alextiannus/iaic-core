import test from 'node:test';import assert from 'node:assert/strict';import {CapabilityHttpClient} from '@immedi/iaic-core/http/client.js';
test('Default HTTP transport retains its global receiver as required by browser fetch',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async function(){assert.equal(this,globalThis);calls++;return Response.json({capabilities:[]});};const client=new CapabilityHttpClient({url:'https://fixture.invalid/capabilities'});assert.deepEqual(await client.list(),[]);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
