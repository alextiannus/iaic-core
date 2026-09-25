import assert from 'node:assert/strict';
import {openFixture} from './fixture.mjs';
const fixture=await openFixture();
try {
 const get=(path,role='operator')=>fetch(fixture.url+path,{headers:{authorization:'Basic '+Buffer.from(role+':'+fixture.password).toString('base64')}});
 for(const role of ['user','organization-admin'])assert.equal((await get('',role)).status,403);
 assert.equal((await fetch(fixture.url)).status,401);
 const page=await get('');assert.equal(page.status,200);assert.match(await page.text(),/Agent 运行看板/);
 for(const path of ['/app.js','/style.css'])assert.equal((await get(path)).status,200);
 const overview=await (await get('/api/overview')).json();assert.equal(overview.count.agents,2);assert.equal(overview.count.healthUnknown,2);
 const first=await (await get('/api/overview?limit=1')).json();assert.equal(first.items.length,1);assert.ok(first.nextCursor);const second=await (await get('/api/overview?limit=1&cursor='+encodeURIComponent(first.nextCursor))).json();assert.equal(second.items[0].agent.id,'external-peer');
 const detail=await (await get('/api/agent?id=maintainer')).json();assert.equal(detail.tasks[0].id,fixture.taskId);assert.equal(detail.models[0].actualModel,null);
 fixture.revoke();assert.equal((await get('/api/overview')).status,403);assert.equal((await fixture.task()).status,'queued');
 console.log(JSON.stringify({example:'core-operations-dashboard',http:true,actualTaskStore:true,operatorOnly:true,organizationAdminDenied:true,revocation:true,mutatedTask:false,browser:false,realExternalProbe:false}));
}finally{await fixture.close();}
