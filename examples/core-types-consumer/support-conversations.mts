import {SupportConversations,PostgresSupportConversationStore,feedbackInstructions} from '@immedi/iaic-core/support/conversations.js';
import type {FeedbackClassification,FeedbackConversation} from '@immedi/iaic-core/support/conversations.js';
import {createSupportConversationCapabilities} from '@immedi/iaic-core/support/capabilities.js';
import type {SupportIssues} from '@immedi/iaic-core/support/service.js';
export function wire(pool:unknown,support:SupportIssues){
 const service=new SupportConversations({support,store:new PostgresSupportConversationStore({pool,namespace:'typed'}),requiredFields:['expected'],resolveMessage:async(messageId,{identity})=>({confirmed:true,messageId,...identity,text:'Synthetic'})});
 const classification:FeedbackClassification={type:'unknown',confidence:0,reason:'Uncertain'};
 const start=(actor:unknown):Promise<FeedbackConversation>=>service.start(actor,{messageId:'m',classification});
 return {start,capabilities:createSupportConversationCapabilities({conversations:service}),instructions:feedbackInstructions};
}
