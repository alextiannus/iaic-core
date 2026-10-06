import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {HostTaskContext} from '@immedi/iaic-core/context/host.js';
import {checkAccessCatalogMatrix} from '@immedi/iaic-core/developer/access-matrix.js';
const f=await fixture();
try{
 const actor={scopeId:'fixture',subjectId:'principal-a'};
 let allowed=true;
 const host=new HostTaskContext({bind:async()=>({schema:'fixture',version:'1',reference:'a',revision:'1',projection:(await f.pool.query("SELECT data FROM revisions WHERE id='a' AND revision='1'")).rows[0].data}),resolve:async({binding})=>(await f.pool.query('SELECT data FROM revisions WHERE id=$1 AND revision=$2',[binding.reference,binding.revision])).rows[0].data,authorize:()=>allowed,readTask:async()=>task});
 const task={id:'old-task',trusted_context:await host.bind({actor,capability:{name:'fixture.read'},idempotencyKey:'old',version:'1'})};
 const service=f.service(),plan=await service.preview(f.operator,{profile:{id:'fixture.reader',version:'v2'},contextIds:['a','b']}),approvalId=await f.approve(plan);
 f.controls.failBefore.add('b');assert.equal((await service.apply(f.operator,{plan,approvalId})).complete,false);
 f.controls.failBefore.clear();assert.equal((await f.service().apply(f.operator,{plan,approvalId})).complete,true);
 assert.equal((await host.project({actor,task})).revision,'1');
 assert.ok(!(await host.project({actor,task})).data.effective.permissions.includes('fixture.write'));
 allowed=false;await assert.rejects(host.project({actor,task}),{statusCode:403});
 const matrix=await checkAccessCatalogMatrix({cases:[{name:'current',context:'a',expected:{host:['fixture.extra','fixture.read','fixture.write']}}],entrances:[{name:'fixture-host',surface:'host',list:async id=>(await f.ports.readContext({contextId:id})).effective.permissions}]});
 assert.equal(matrix.passed,true);
 console.log(JSON.stringify({accessProfiles:true,persistentRecovery:true,oldTaskRevisionPreserved:true,currentAuthorization:true,catalogMatrix:true,applicationAdoption:false}));
}finally{await f.close();}
