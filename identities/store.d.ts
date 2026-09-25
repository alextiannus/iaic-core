import type {DatabasePool} from '../developer/templates/agent/app.mjs';
export interface AgentScope {applicationId:string;definitionId:string;subjectId:string}
export interface AgentInstance {id:string;state:'active'|'paused';revision:number;createdAt:Date;updatedAt:Date}
export class AgentIdentityStore {
 constructor(options:{pool:DatabasePool});
 initialize():Promise<void>;
 find(input:{id:string;definitionId:string}):Promise<(AgentScope&{id:string;state:'active'|'paused';revision:number})|null>;
 get(scope:AgentScope):Promise<AgentInstance|null>;
 ensure(scope:AgentScope):Promise<AgentInstance>;
 page(input:{definitionId:string;after?:string|null;limit?:number}):Promise<{items:Array<AgentScope&{id:string;state:'active'|'paused';revision:number}>;next:string|null}>;
 history(scope:AgentScope,input?:{after?:number;limit?:number}):Promise<Array<{revision:number;state:'active'|'paused';created_at:Date}>>;
 setState(scope:AgentScope,input:{state:'active'|'paused';expectedRevision:number}):Promise<AgentInstance>;
}
