import type {SupportIdentity} from './service.js';
export type SupportSourceKind='end_user_reported'|'user_assistant_detected'|'business_ai_detected'|'system_observed';
export interface SupportObservation {
 confirmed:true;scopeId:string;subjectId:string;sourceKind:Exclude<SupportSourceKind,'end_user_reported'>;sourceId:string;summary:string;
 taskId?:string;requestId?:string;releaseId?:string;errorCode?:string;affectedSubjectId?:string;agentId?:string;evidenceRef?:string;
}
export const SUPPORT_SOURCE_KINDS:readonly SupportSourceKind[];
export function sourceKind(identity:SupportIdentity):SupportSourceKind;
export function observationReport(identity:SupportIdentity,sourceId:string,value:unknown):Record<string,string>;
