import {fail,text} from './store.js';
export const SUPPORT_SOURCE_KINDS=Object.freeze(['end_user_reported','user_assistant_detected','business_ai_detected','system_observed']);
export function sourceKind(identity){
 const kind=identity.sourceKind??'end_user_reported';
 if(!SUPPORT_SOURCE_KINDS.includes(kind))throw fail('SUPPORT_INVALID_SOURCE_KIND');
 return kind;
}
// The Host resolves bounded, currently authorized facts; this is not a bug verdict.
export function observationReport(identity,sourceId,value){
 const kind=sourceKind(identity);
 if(!value||value.confirmed!==true||value.scopeId!==identity.scopeId||value.subjectId!==identity.subjectId||value.sourceKind!==kind||value.sourceId!==sourceId)throw fail('SUPPORT_OBSERVATION_UNVERIFIED',409);
 const report={summary:text(value.summary,2000),sourceKind:kind,sourceId:text(sourceId),assessment:'candidate'};
 for(const key of ['taskId','requestId','releaseId','errorCode','affectedSubjectId','agentId','evidenceRef'])if(value[key]!==undefined)report[key]=text(value[key]);
 if(kind!=='system_observed'&&!report.agentId)throw fail('SUPPORT_OBSERVATION_AGENT_REQUIRED');
 return report;
}
