export interface InboxInput {requestKey:string;notificationId:string;title:string;summary:string;category:string;priority:string;relatedObjectRef?:string|null;actionRef?:string|null}
export interface InboxItem extends Omit<InboxInput,'relatedObjectRef'|'actionRef'> {id:string;scopeId:string;sequence:string;relatedObjectRef:string|null;actionRef:string|null;createdAt:string;deliveredAt:string;readAt:string|null;archivedAt:string|null;version:number}
export type InboxSummary = Pick<InboxItem,'id'|'title'|'category'|'priority'|'createdAt'|'deliveredAt'|'readAt'|'archivedAt'|'version'>;
export interface PageOptions {before?:string;limit?:number;archived?:boolean}
export interface Page<T> {items:T[];unreadCount:number;next:string|null}
export type ProjectionKind = 'conversation'|'task';
export type ProjectionResult = {status:'delivered';reference:string}|{status:'not_sent'|'unknown';reference?:string};
export interface Projection {id:string;scopeId:string;itemId:string;kind:ProjectionKind;requestKey:string;state:'sending'|'unknown'|'delivered'|'not_sent';attempt:string;result:ProjectionResult|null}
export interface History {sequence:string;state:Projection['state'];result:ProjectionResult|null;created_at:Date}
export interface InboxStore {
 receive(scope:string,input:InboxInput):Promise<InboxItem>;
 get(scope:string,id:string):Promise<InboxItem|null>;
 list(scope:string,input?:PageOptions):Promise<Page<InboxItem>>;
 mark(scope:string,id:string,action:'read'|'unread'|'archive'):Promise<InboxItem>;
 claim(scope:string,id:string,kind:ProjectionKind,requestKey:string):Promise<{projection:Projection;claimed:boolean}>;
 finish(job:Projection,result:ProjectionResult):Promise<Projection>;
 history(scope:string,id:string):Promise<History[]>;
}
export class PostgresInboxStore implements InboxStore {
 constructor(options:{pool:any;namespace:string});
 initialize():Promise<void>;
 receive:InboxStore['receive'];get:InboxStore['get'];list:InboxStore['list'];mark:InboxStore['mark'];claim:InboxStore['claim'];finish:InboxStore['finish'];history:InboxStore['history'];
}
