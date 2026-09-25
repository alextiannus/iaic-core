import type {DatabasePool} from '../developer/templates/agent/app.mjs';
import type {AgentDescriptor,RuntimeSignal} from './service.js';
export class OperationsRegistry {
 constructor(options:{pool:DatabasePool;namespace:string});
 initialize():Promise<void>;
 register(agent:AgentDescriptor):Promise<AgentDescriptor>;
 read(id:string):Promise<AgentDescriptor>;
 page(input?:{after?:string|null;limit?:number;workspaceIds?:string[]|null}):Promise<{items:AgentDescriptor[];next:string|null;complete:boolean}>;
 startExecutor(executorId:string):Promise<string>;
 heartbeat(executorId:string,input:{generation:string;sequence:number;ttlMs?:number;state?:RuntimeSignal['state'];basis?:'observed'|'reported';reason?:string}):Promise<void>;
 presence(executorId:string):Promise<RuntimeSignal|null>;
}
