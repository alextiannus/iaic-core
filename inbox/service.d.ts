import type {InboxStore,InboxInput,InboxItem,InboxSummary,PageOptions,Page,ProjectionKind,ProjectionResult,Projection,History} from './store.js';
export interface ProjectionContext {idempotencyKey:string;item:InboxItem}
export interface ProjectionAdapter {send(context:ProjectionContext):Promise<ProjectionResult>;query(context:ProjectionContext):Promise<ProjectionResult>}
export interface InboxOptions<A> {store:InboxStore;resolveScope(actor:A):string|Promise<string>;authorize(actor:A,context:{action:string;item?:InboxItem}):boolean|Promise<boolean>;resolveProjection?(actor:A,context:{kind:ProjectionKind;item:InboxItem}):ProjectionAdapter|Promise<ProjectionAdapter>}
export class Inbox<A=unknown> {
 constructor(options:InboxOptions<A>);
 receive(actor:A,input:InboxInput):Promise<InboxItem>;
 list(actor:A,input?:PageOptions):Promise<Page<InboxSummary>>;
 unreadCount(actor:A):Promise<number>;
 get(actor:A,id:string):Promise<InboxItem>;
 markRead(actor:A,id:string):Promise<InboxItem>;
 markUnread(actor:A,id:string):Promise<InboxItem>;
 archive(actor:A,id:string):Promise<InboxItem>;
 history(actor:A,id:string):Promise<History[]>;
 project(actor:A,id:string,input:{kind:ProjectionKind}):Promise<Projection>;
}
