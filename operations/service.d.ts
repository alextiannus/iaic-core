export interface Reference {source:string;id:string;revision:string|null}
export interface AgentDescriptor {id:string;name:string;role:'platform'|'user-assistant'|'business'|null;location:'internal'|'external';lifecycle:'active'|'paused'|'retired';workspaceId:string;principalId:string;reference:Reference}
export interface TaskSummary {id:string;status:'queued'|'running'|'waiting'|'succeeded'|'failed'|'cancelled';waitingReason:string|null;resultState:'pending'|'known'|'unknown';reference:Reference}
export type EvidenceBasis='reported'|'observed'|'verified';
export interface RuntimeSignal {id:string;kind:'executor'|'model'|'connector';state:'healthy'|'degraded'|'unavailable'|'unknown';basis:EvidenceBasis;observedAt:string;validUntil:string;reason:string;reference:Reference}
export interface ModelUse {taskId:string;configuredProfileRef:string|null;boundModel:string|null;requestedModel:string|null;actualModel:string|null;provider:string|null;basis:EvidenceBasis;reference:Reference}
export interface Interaction {id:string;type:'request'|'message'|'delegation'|'review'|'result'|'dependency';from:string;to:string;taskId:string|null;stage:'requested'|'received'|'admitted'|'running'|'result-recorded'|'verified'|'unknown';basis:EvidenceBasis;reference:Reference}
export interface Envelope<T> {items:T[];complete:boolean;observedAt:string;validUntil:string;reference:Reference}
export interface PageInput {limit?:number;cursor?:string}
export interface AgentPage {schemaVersion:1;asOf:string;items:AgentDescriptor[];nextCursor:string|null;complete:boolean}
export interface SourceStatus {state:'fresh'|'stale'|'invalid'|'timeout'|'invalid-source'|'source-unavailable';complete:boolean;reference:Reference|null;observedAt:string|null;validUntil:string|null}
export interface TaskCounts {queued:number;running:number;waiting:number;succeeded:number;failed:number;cancelled:number;unknownResults:number}
export interface Health {state:RuntimeSignal['state'];complete:boolean;reasons:string[]}
export interface AgentView {schemaVersion:1;asOf:string;agent:AgentDescriptor;activity:'working'|'waiting'|'queued'|'idle'|'unknown';taskCounts:TaskCounts;health:Health;sources:Record<'tasks'|'signals'|'models'|'interactions',SourceStatus>;tasks:TaskSummary[];signals:Array<RuntimeSignal&{freshness:'fresh'|'stale'|'invalid'}>;models:ModelUse[];interactions:Interaction[]}
export interface Overview {schemaVersion:1;asOf:string;items:Array<{agent:AgentDescriptor;activity:AgentView['activity'];taskCounts:TaskCounts;health:Health;asOf:string;complete:boolean}>;nextCursor:string|null;complete:boolean;count:{scope:'returned-page';agents:number;healthUnknown:number}}
export interface SourceContext<A> {actor:A;scope:string;agent:AgentDescriptor;signal:AbortSignal}
export interface OperationsOptions<A> {
 namespace:string;cursorKey:Uint8Array;resolveScope(actor:A):string|Promise<string>;
 authorize(actor:A,request:{operation:'agents'|'agent'|'overview';id:string|null;scope:string}):boolean|Promise<boolean>;
 listAgents(request:{actor:A;scope:string;limit:number;after:string|null;signal:AbortSignal}):Promise<{items:AgentDescriptor[];next:string|null;complete:boolean}>;
 readAgent(request:{actor:A;scope:string;id:string;signal:AbortSignal}):Promise<AgentDescriptor>;
 sources:{tasks(context:SourceContext<A>):Promise<Envelope<TaskSummary>>;signals(context:SourceContext<A>):Promise<Envelope<RuntimeSignal>>;models(context:SourceContext<A>):Promise<Envelope<ModelUse>>;interactions(context:SourceContext<A>):Promise<Envelope<Interaction>>};
 clock?:()=>number;timeoutMs?:number;
}
export class Operations<A=unknown> {
 constructor(options:OperationsOptions<A>);
 agents(actor:A,input?:PageInput):Promise<AgentPage>;
 agent(actor:A,id:string):Promise<AgentView>;
 overview(actor:A,input?:PageInput):Promise<Overview>;
}
