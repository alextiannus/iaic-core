import assert from 'node:assert/strict';
import {defineCapability,CapabilityDispatcher} from '@immedi/iaic-core';
const schema={$id:'urn:iaic:test:consumer-request',type:'object',properties:{value:{type:'integer'}},required:['value'],additionalProperties:false};
const define=input=>defineCapability({name:'consumer.echo',description:'Consumer schema reuse',effect:'read',input,output:{type:'object'},authorize:()=>true,implementation:{kind:'function',execute:input=>input}});
{
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
}
console.log(JSON.stringify({example:'core-schema-consumer',equivalentIds:true,changedIdRejected:true,validatorsUnchanged:true}));
