import test from 'node:test';
import assert from 'node:assert/strict';
import {wireToolNames} from '@immedi/iaic-core/agent/tool-names.js';
import {OpenAIProvider} from '@immedi/iaic-core/agent/openai-provider.js';

test('tool names preserve recognizable names, avoid collisions and control names, and do not depend on order',()=>{
 const logical=['my_write_workspace','assistant.skills.read','a.b','a_b','iaic_finish','iaic_wait','x'.repeat(90),'x'.repeat(89)+'y'];
 const tools=logical.map(name=>({name})),names=wireToolNames(tools);
 assert.equal(names[0],'my_write_workspace');assert.equal(names[1],'assistant_skills_read');assert.equal(names[3],'a_b');assert.notEqual(names[2],'a_b');
 assert.equal(new Set(names).size,names.length);assert.ok(names.every(name=>/^[A-Za-z0-9_-]{1,64}$/.test(name)&&!['iaic_finish','iaic_wait'].includes(name)));
 assert.deepEqual(wireToolNames([...tools].reverse()),[...names].reverse());
 assert.throws(()=>wireToolNames([{name:'a'},{name:'a'}]),/unique/);
 // Reject an intentionally supplied name that collides with a derived hash.
 assert.throws(()=>wireToolNames([...tools,{name:names[2]}]),/collide/);
});

test('provider dispatches only advertised names to their exact capability, including collisions',async()=>{
 const tools=['my_write_workspace','a.b','a_b','iaic_finish'].map(name=>({name,description:'Test operation',inputSchema:{type:'object'}}));
 for(const expected of tools){
  const provider=new OpenAIProvider({apiKey:'fixture',model:'fixture',fetchImpl:async(_url,options)=>{
   const request=JSON.parse(options.body),wire=wireToolNames(tools)[tools.indexOf(expected)];
   assert.ok(request.tools.some(tool=>tool.name===wire));
   return new Response(JSON.stringify({status:'completed',output:[{type:'function_call',name:wire,arguments:'{}'}]}));
  }});
  const action=await provider.next({tools,messages:[],outputSchema:{type:'object'}});assert.equal(action.type,'call');assert.equal(action.name,expected.name);
 }
 const invalid=new OpenAIProvider({apiKey:'fixture',model:'fixture',fetchImpl:async()=>new Response(JSON.stringify({status:'completed',output:[{type:'function_call',name:'cap_0',arguments:'{}'}]}))});
 await assert.rejects(invalid.next({tools,messages:[],outputSchema:{type:'object'}}),/unconfigured/);
});
