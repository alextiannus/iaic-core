import {SupportIssues} from '@immedi/iaic-core/support/service.js';
import type {SupportIdentity} from '@immedi/iaic-core/support/service.js';
import {PostgresSupportStore} from '@immedi/iaic-core/support/store.js';
import {SupportFollowUp,createSupportResolutionConsumer} from '@immedi/iaic-core/support/follow-up.js';
import {createSupportCapabilities,createSupportFollowUpCapabilities} from '@immedi/iaic-core/support/capabilities.js';
import {SUPPORT_SOURCE_KINDS} from '@immedi/iaic-core/support/observations.js';
import type {Notifications} from '@immedi/iaic-core/notifications/service.js';
export function compose(pool:unknown,notifications:Notifications){
 const identity:SupportIdentity={scopeId:'fixture',subjectId:'business-agent',sourceKind:'business_ai_detected'};
 const store=new PostgresSupportStore({pool,namespace:'fixture'});
 const support=new SupportIssues({store,resolveIdentity:()=>identity,authorize:()=>false,resolveObservation:sourceId=>({confirmed:true,scopeId:identity.scopeId,subjectId:identity.subjectId,sourceKind:'business_ai_detected',sourceId,summary:'bounded',agentId:identity.subjectId})});
 const followUp=new SupportFollowUp({support,store,notifications,notificationActor:()=>identity,resolveRead:(_id,c)=>({confirmed:true,scopeId:c.identity.scopeId,issueId:c.issue.id,revision:c.revision,notificationId:c.notificationId,recipientId:c.issue.reporterId,readAt:'2026-10-05T10:00:00Z'})});
 const worker=createSupportResolutionConsumer({support,store,consumerId:'fixture',resolveActor:()=>identity});
 return {support,followUp,worker,kinds:SUPPORT_SOURCE_KINDS,capabilities:[...createSupportCapabilities({support}),...createSupportFollowUpCapabilities({followUp})]};
}
