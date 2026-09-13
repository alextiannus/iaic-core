import {fixture} from './delegated-fixture.mjs';
import {defineCapability,DelegationParents} from '@immedi/iaic-core';
await fixture(async f=>{
 const parent=defineCapability({name:'parent.run',description:'Parent recovery fixture',input:{type:'object'},output:{type:'object'},effect:'read',authorize:a=>f.permitted.has(a.subjectId),implementation:{kind:'agent',instructions:'Query the original effect',tools:['records.write','records.lookup'],verify:async()=>true}});
 f.dispatcher.capabilities.set(parent.name,parent);
 f.authority.parents=new DelegationParents({grants:f.grants,allowLink:()=>true});
 const write=f.dispatcher.capabilities.get('records.write'),execute=write.implementation.execute;
 f.dispatcher.capabilities.set(write.name,defineCapability({...write,implementation:{...write.implementation,execute:async(i,c)=>{
  await execute(i,c);
  process.send({phase:'effect-committed',effectKey:c.callId});
  await new Promise(()=>{}); // Parent kills this process before any result can return.
 }}}));
 await f.getRuntime().tick();
 throw new Error('Worker must not finish before SIGKILL');
},{reuseSchema:process.argv[2]});
