export interface CoreActor {scopeId:string;subjectId:string}
export interface HostBinding {source:'host';schema:string;version:string;reference:string;revision:string;digest:string;owner:CoreActor}
export interface HostTask {id:string;trusted_context:HostBinding|null}
export interface HostProjection {source:'host';schema:string;version:string;revision:string;digest:string;data:Record<string,unknown>}
export interface HostContextPorts<A extends CoreActor=CoreActor> {
 bind(request:{actor:CoreActor;capability:string;requestKey:string;hostVersion:string}):Promise<{schema:string;version:string;reference:string;revision:string;projection:Record<string,unknown>}>;
 resolve(request:{actor:CoreActor;taskId:string;binding:HostBinding}):Promise<Record<string,unknown>>;
 authorize(request:{actor:CoreActor;taskId:string|null;binding:HostBinding}):boolean|Promise<boolean>;
 readTask(actor:CoreActor,id:string):Promise<HostTask>;
 restoreActor?:((request:{actor:CoreActor;taskId:string;binding:HostBinding})=>Promise<A>)|null;
}
export function hostProjection(value:Record<string,unknown>):{data:Record<string,unknown>;digest:string};
export function checkedHostBinding(value:unknown):HostBinding;
export class HostTaskContext<A extends CoreActor=CoreActor> {
 constructor(ports:HostContextPorts<A>);
 bind(request:{actor:CoreActor;capability:{name:string};idempotencyKey:string;version:string}):Promise<HostBinding>;
 check(request:{actor:CoreActor;task:HostTask}):Promise<HostBinding>;
 project(request:{actor:CoreActor;task:HostTask}):Promise<HostProjection>;
 restoreActor(request:{actor:CoreActor;taskId:string}):Promise<A>;
}
