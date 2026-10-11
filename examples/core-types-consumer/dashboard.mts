import {createOperationsDashboard} from '@immedi/iaic-core/operations/dashboard.js';
import type {DashboardOptions} from '@immedi/iaic-core/operations/dashboard.js';
export function mount(options:DashboardOptions<{subjectId:string}>) {return createOperationsDashboard(options);}
if(typeof createOperationsDashboard!=='function')throw Error('Missing packaged dashboard export');

import {OperationsRegistry} from '@immedi/iaic-core/operations/registry.js';
import {AgentIdentityStore} from '@immedi/iaic-core/identities/store.js';
import type {DatabasePool} from '@immedi/iaic-core/developer/templates/agent/app.mjs';
export async function inventory(pool:DatabasePool){
 const registry=new OperationsRegistry({pool,namespace:'application'});
 await registry.initialize();
 const generation=await registry.startExecutor('executor');
 await registry.heartbeat('executor',{generation,sequence:1,basis:'reported'});
 const identities=new AgentIdentityStore({pool});
 return {presence:await registry.presence('executor'),page:await registry.page({workspaceIds:['workspace']}),identities:await identities.page({definitionId:'job'})};
}

import {SkillInventory} from '@immedi/iaic-core/operations/skill-inventory.js';
import type {Operations} from '@immedi/iaic-core/operations/service.js';
export function skillInventory(operations:Operations<{subjectId:string}>,cursorKey:Uint8Array){
 const snapshot={items:[],complete:true,observedAt:new Date().toISOString(),validUntil:new Date(Date.now()+60000).toISOString()};
 const skills=new SkillInventory({operations,cursorKey,listCatalog:async()=>snapshot,readBindings:async()=>snapshot});
 return skills.list({subjectId:'operator'},{agentId:'worker',status:'installed'});
}
