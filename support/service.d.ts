export interface SupportIdentity {scopeId:string;subjectId:string}
export interface SupportIssue {id:string;scopeId:string;reporterId:string;report:Record<string,string>;state:string;revision:number}
export interface SupportEvent {revision:number;state:string;message:string;evidence:unknown;createdAt:string}
export interface SupportStore {
 create(scope:string,reporter:string,input:{requestKey:string;report:Record<string,string>}):Promise<SupportIssue>;
 get(scope:string,id:string):Promise<SupportIssue|null>;
 list(scope:string,input:{reporterId?:string;limit?:number;afterId?:string}):Promise<SupportIssue[]>;
 history(scope:string,id:string):Promise<SupportEvent[]>;
 change(scope:string,id:string,input:Record<string,unknown>):Promise<SupportIssue>;
}
export class SupportIssues {
 constructor(options:{store:SupportStore;resolveIdentity:(actor:any)=>SupportIdentity|Promise<SupportIdentity>;authorize:(actor:any,context:any)=>boolean|Promise<boolean>;resolveResolution?:(id:string,context:{actor:any;issue:SupportIssue})=>unknown|Promise<unknown>;notifications?:{enqueue(actor:any,input:any):Promise<any>};notificationActor?:(context:any)=>any});
 report(actor:any,input:{requestKey:string;summary:string;taskId?:string;requestId?:string;releaseId?:string;errorCode?:string}):Promise<SupportIssue>;
 get(actor:any,input:{id:string}):Promise<SupportIssue&{history:SupportEvent[]}>;
 list(actor:any,input?:{limit?:number;afterId?:string}):Promise<SupportIssue[]>;
 queue(actor:any,input?:{limit?:number;afterId?:string}):Promise<SupportIssue[]>;
 update(actor:any,input:{id:string;expectedRevision:number;state:string;message:string;evidenceId?:string}):Promise<SupportIssue>;
 notify(actor:any,input:{id:string;revision:number}):Promise<any>;
}
