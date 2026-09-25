import {Operations} from '@immedi/iaic-core/operations/service.js';
import type {OperationsOptions,AgentView,Overview} from '@immedi/iaic-core/operations/service.js';
import {createOperationsCapabilities} from '@immedi/iaic-core/operations/capabilities.js';
type Actor={subjectId:string;scopeId:string};
export function compose(options:OperationsOptions<Actor>) {
 const operations=new Operations(options);
 const agent=(actor:Actor,id:string):Promise<AgentView>=>operations.agent(actor,id);
 const overview=(actor:Actor):Promise<Overview>=>operations.overview(actor,{limit:5});
 return {agent,overview,capabilities:createOperationsCapabilities({operations})};
}
if(typeof Operations!=='function')throw Error('Operations subpath unavailable');
console.log(JSON.stringify({operationsTypes:true,closedSourceContracts:true}));
