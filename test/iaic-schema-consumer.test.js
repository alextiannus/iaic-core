import test from 'node:test';
import assert from 'node:assert/strict';
import {defineCapability,CapabilityDispatcher} from '../index.js';
const schema={$id:'urn:iaic:test:consumer-request',type:'object',properties:{value:{type:'integer'}},required:['value'],additionalProperties:false};
const define=input=>defineCapability({name:'consumer.echo',description:'Consumer schema reuse',effect:'read',input,output:{type:'object'},authorize:()=>true,implementation:{kind:'function',execute:input=>input}});
test('independent consumers reuse equivalent stable schema IDs and reject changed definitions',async()=>{
 const first=new CapabilityDispatcher({capabilities:[define(schema)]});
 const reordered={additionalProperties:false,required:['value'],properties:{value:{type:'integer'}},type:'object',$id:schema.$id};
 const second=new CapabilityDispatcher({capabilities:[define(reordered)]});
 for(const dispatcher of [first,second]){
  assert.deepEqual(await dispatcher.invoke('consumer.echo',{value:3},{actor:{subjectId:'consumer'}}),{value:3});
  await assert.rejects(dispatcher.invoke('consumer.echo',{value:'3'},{actor:{subjectId:'consumer'}}),{statusCode:400});
 }
 assert.throws(()=>define({...schema,properties:{value:{type:'string'}}}),{code:'CAPABILITY_SCHEMA_CONFLICT',statusCode:409});
 assert.deepEqual(await first.invoke('consumer.echo',{value:4},{actor:{subjectId:'consumer'}}),{value:4});
 assert.equal(Object.isFrozen(schema),false);
});
