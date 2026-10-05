import type {SupportIssues,SupportIssue,SupportIdentity,SupportStore} from './service.js';
import type {SupportEventConsumer,PendingSupportEvent} from './consumer.js';
import type {Notifications} from '../notifications/service.js';
export interface SupportReadReceipt {notificationId:string;recipientId:string;evidenceId:string;readAt:string}
export interface SupportReadEvidence {confirmed:true;scopeId:string;issueId:string;revision:number;notificationId:string;recipientId:string;readAt:string}
export interface SupportFollowUpStatus {
 issueId:string;revision:number;currentRevision:number;historical:boolean;recipientId:string;
 admission:'admitted'|'not_admitted';notificationId:string|null;delivery:string;
 read:'read'|'not_verified';readAt:string|null;readEvidenceId:string|null;
}
export interface SupportFollowUpStore extends SupportStore {
 readReceipt(scope:string,id:string,revision:number):Promise<SupportReadReceipt|null>;
 recordRead(scope:string,id:string,revision:number,receipt:SupportReadReceipt):Promise<SupportReadReceipt>;
}
export class SupportFollowUp {
 constructor(options:{support:SupportIssues;store:SupportFollowUpStore;notifications:Pick<Notifications,'get'>;notificationActor:(context:any)=>any;resolveRead?:(evidenceId:string,context:{actor:any;identity:SupportIdentity;issue:SupportIssue;revision:number;notificationId:string})=>SupportReadEvidence|Promise<SupportReadEvidence>});
 get(actor:any,input:{id:string;revision:number}):Promise<SupportFollowUpStatus>;
 recordRead(actor:any,input:{id:string;revision:number;evidenceId:string}):Promise<SupportFollowUpStatus>;
}
export function createSupportResolutionConsumer(options:{support:SupportIssues;store:SupportStore&{pendingEvents(consumerId:string,input:{limit:number}):Promise<PendingSupportEvent[]>;acknowledgeEvent(consumerId:string,event:PendingSupportEvent):Promise<void>};consumerId:string;resolveActor:(scopeId:string)=>any}):SupportEventConsumer;
