import type {SupportIssues} from './service.js';
export interface FeedbackClassification {type:'bug'|'issue'|'improvement'|'unknown';confidence:number;reason:string}
export interface FeedbackDetails {expected?:string;steps?:string;impact?:string}
export interface FeedbackStart {messageId:string;classification?:FeedbackClassification;details?:FeedbackDetails}
export interface FeedbackReply {id:string;requestKey:string;expectedRevision:number;messageId?:string;classification?:FeedbackClassification;details?:FeedbackDetails}
export interface FeedbackConversation {issueId:string;revision:number;messageId:string;original:string;classification:FeedbackClassification&{assessment:'suggested'};details:FeedbackDetails;requiredFields:string[];missingFields:string[];state:'clarifying'|'ready';initial?:unknown;history?:Array<{revision:number;change:unknown}>}
export interface SupportConversationStore {
 start(scope:string,id:string,reporter:string,initial:any,required:string[]):Promise<FeedbackConversation>;
 get(scope:string,id:string):Promise<FeedbackConversation|null>;
 reply(scope:string,id:string,reporter:string,input:any):Promise<FeedbackConversation>;
}
export const feedbackInstructions:string;
export class SupportConversations {
 constructor(options:{support:SupportIssues;store:SupportConversationStore;resolveMessage:(messageId:string,context:any)=>Promise<{confirmed:boolean;messageId:string;scopeId:string;subjectId:string;text:string}>;requiredFields?:Array<keyof FeedbackDetails>});
 start(actor:any,input:FeedbackStart):Promise<FeedbackConversation>;
 get(actor:any,input:{id:string}):Promise<FeedbackConversation>;
 review(actor:any,input:{id:string}):Promise<FeedbackConversation>;
 reply(actor:any,input:FeedbackReply):Promise<FeedbackConversation>;
}
export class PostgresSupportConversationStore implements SupportConversationStore {
 constructor(options:{pool:any;namespace:string});initialize():Promise<void>;
 start(scope:string,id:string,reporter:string,initial:any,required:string[]):Promise<FeedbackConversation>;
 get(scope:string,id:string):Promise<FeedbackConversation|null>;
 reply(scope:string,id:string,reporter:string,input:any):Promise<FeedbackConversation>;
}
