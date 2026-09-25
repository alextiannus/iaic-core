import type {CoreActor,HostBinding} from '../context/host.js';
import type {PostgresNotificationStore,NotificationJob} from './store.js';
export interface TaskWakeIntent {topic:string;target:CoreActor;context:HostBinding;capability:string;taskRequestKey:string;input:Record<string,unknown>;authorityRef:string}
export interface WakeTask {id:string;request_key:string;capability:string;input:Record<string,unknown>;trusted_context:HostBinding;owner:CoreActor}
export type WakeLookup = {status:'found';task:WakeTask}|{status:'unknown'}|{status:'not_sent';evidenceRef:string};
export interface TaskWakeOptions<A> {
 store:PostgresNotificationStore;channel:string;topics:string[];maxAttempts?:number;
 resolveScope(target:CoreActor):string|Promise<string>;
 authorizeEnqueue(actor:A,intent:TaskWakeIntent):boolean|Promise<boolean>;
 authorizeSend(intent:TaskWakeIntent):boolean|Promise<boolean>;
 authorizeReconcile(intent:TaskWakeIntent,task:WakeTask|null):boolean|Promise<boolean>;
 admitTask(context:{intent:TaskWakeIntent;idempotencyKey:string;signal?:AbortSignal|undefined}):Promise<WakeTask>;
 findTask(context:{intent:TaskWakeIntent;idempotencyKey:string}):Promise<WakeLookup>;
 repairBinding(context:{intent:TaskWakeIntent;task:WakeTask;idempotencyKey:string}):Promise<{bound:boolean;reference:string}>;
}
export function taskWakeIntent(input:TaskWakeIntent):TaskWakeIntent;
export class TaskWake<A=unknown> {
 constructor(options:TaskWakeOptions<A>);
 enqueue(actor:A,input:{requestKey:string;intent:TaskWakeIntent}):Promise<NotificationJob>;
 pump(input?:{after?:string|null;limit?:number;signal?:AbortSignal}):Promise<{results:Array<{id:string;state:string;skipped?:string;error?:string}>;next:string|null}>;
}
