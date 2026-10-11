import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {SkillInventory} from '../operations/skill-inventory.js';
import {Operations} from '../operations/service.js';
const now=Date.parse('2026-10-12T00:00:00Z');
const packet=(items,extra={})=>({items,complete:true,observedAt:new Date(now).toISOString(),validUntil:new Date(now+60000).toISOString(),...extra});
const meta=id=>({id,name:id,description:'Skill '+id,version:'v2','allowed-tools':'Read',metadata:{author:'IAiC',secret:'must-not-project'}});
const bound=(id,extra={})=>({id,installedVersion:'v2',enabled:true,readiness:'unknown',reason:'Tools have not been checked',...extra});
function fixture(){
 const state={scope:'tenant:operator:v1',allowed:true,catalog:packet([meta('a'),meta('b'),meta('c')]),bindings:packet([bound('a',{installedVersion:'v1',readiness:'ready'}),bound('b',{enabled:false}),bound('orphan')]),afterRead:()=>{}};
 const operations=new Operations({namespace:'skills-test',cursorKey:randomBytes(32),resolveScope:()=>state.scope,authorize:(_actor,{id})=>state.allowed&&id!=='hidden',listAgents:async()=>({items:[],next:null,complete:true}),readAgent:async({id})=>({id,name:id,role:'business',location:'internal',lifecycle:'active',workspaceId:'tenant',principalId:'worker',reference:{source:'host',id,revision:'1'}}),sources:Object.fromEntries(['tasks','models','signals','interactions'].map(k=>[k,async()=>({...packet([]),reference:{source:'host',id:k,revision:'1'}})])),clock:()=>now});
 const inventory=new SkillInventory({operations,cursorKey:randomBytes(32),clock:()=>now,listCatalog:async()=>{state.afterRead();return state.catalog;},readBindings:async()=>state.bindings});
 return {state,inventory};
}
test('catalog is independent of installed, enabled and execution readiness; projects only public metadata',async()=>{
 const {inventory}=fixture();const system=await inventory.list({});assert.equal(system.counts.supported,3);assert.equal(system.counts.installed,null);assert.equal(system.items[0].installed,null);assert.equal(system.items[0].metadata.secret,undefined);
 const page=await inventory.list({},{agentId:'worker'});assert.equal(page.counts.installed,3);assert.equal(page.items[0].updateAvailable,true);assert.equal(page.items[1].readiness,'blocked');assert.equal(page.items[2].installed,false);assert.equal(page.items[3].registered,false);assert.equal(page.items[3].readiness,'unknown');
 assert.equal((await inventory.list({},{agentId:'worker',status:'not-installed'})).items[0].id,'c');
 assert.equal((await inventory.list({},{query:'SKILL B'})).items[0].id,'b');
});
test('incomplete and stale source never turns absence into not-installed or grants readiness',async()=>{
 const {state,inventory}=fixture();state.bindings.complete=false;
 let page=await inventory.list({},{agentId:'worker'});assert.equal(page.items.find(x=>x.id==='c').installed,null);assert.equal(page.complete,false);
 state.bindings.validUntil=new Date(now).toISOString();page=await inventory.list({},{agentId:'worker'});assert.equal(page.items[0].readiness,'unknown');assert.equal(page.items[0].updateAvailable,null);
 state.catalog.validUntil=new Date(now).toISOString();assert.equal((await inventory.list({})).complete,false);assert.equal((await inventory.list({},{agentId:'worker'})).items.find(x=>x.id==='orphan').registered,null);
});
test('pagination covers the complete catalog and rejects changed snapshot, Agent, scope and filters',async()=>{
 const {state,inventory}=fixture();const first=await inventory.list({},{limit:1});assert.equal(first.items[0].id,'a');assert.equal((await inventory.list({},{limit:1,cursor:first.nextCursor})).items[0].id,'b');
 for(const change of [{query:'x'},{agentId:'other'},{limit:2}])await assert.rejects(inventory.list({},{limit:1,cursor:first.nextCursor,...change}),{statusCode:400});
 state.scope='different';await assert.rejects(inventory.list({},{limit:1,cursor:first.nextCursor}),{statusCode:400});state.scope='tenant:operator:v1';state.catalog.items[0].version='v3';await assert.rejects(inventory.list({},{limit:1,cursor:first.nextCursor}),{statusCode:400});
});
test('denies hidden Agents and revoked access during source reads',async()=>{
 const {state,inventory}=fixture();await assert.rejects(inventory.list({},{agentId:'hidden'}),{statusCode:403});state.afterRead=()=>{state.allowed=false;};await assert.rejects(inventory.list({}),{statusCode:403});
});
test('invalid input, duplicates, future timestamps and invalid binding fail explicitly',async()=>{
 const {state,inventory}=fixture();for(const input of [{limit:0},{limit:51},{status:'installed'},{agentId:''},{other:'value'},{query:'x'.repeat(201)}])await assert.rejects(inventory.list({},input),{statusCode:400});
 state.catalog.items.push(meta('a'));await assert.rejects(inventory.list({}),{statusCode:502});state.catalog.items.pop();state.catalog.observedAt=new Date(now+1).toISOString();await assert.rejects(inventory.list({}),{statusCode:502});state.catalog.observedAt=new Date(now).toISOString();state.bindings.items[0].enabled='true';await assert.rejects(inventory.list({},{agentId:'worker'}),{statusCode:502});
});
test('hung source is bounded and receives cancellation',async()=>{
 const {inventory}=fixture();inventory.timeoutMs=10;let signal;inventory.listCatalog=async input=>{signal=input.signal;return new Promise(()=>{});};await assert.rejects(inventory.list({}),{statusCode:504});assert.equal(signal.aborted,true);
});
test('missing Agent bindings are a source error, not a complete catalog-only response',async()=>{
 const {state,inventory}=fixture();for(const value of [null,undefined,false]){state.bindings=value;await assert.rejects(inventory.list({},{agentId:'worker'}),{statusCode:502});}
});
test('Agent-specific access is checked again after snapshot reads even if skills permission remains',async()=>{
 const {state,inventory}=fixture();let agentAllowed=true;
 inventory.operations.authorize=(_actor,{operation})=>operation!=='agent'||agentAllowed;
 state.afterRead=()=>{agentAllowed=false;};await assert.rejects(inventory.list({},{agentId:'worker'}),{statusCode:403});
});
test('snapshot timestamps must be strings, not coercible values',async()=>{
 const {state,inventory}=fixture();state.catalog.observedAt=[new Date(now).toISOString()];await assert.rejects(inventory.list({}),{statusCode:502});
});
