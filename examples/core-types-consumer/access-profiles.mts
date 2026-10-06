import {AccessProfileReconciler} from '@immedi/iaic-core/context/access-profiles.js';
import type {AccessProfilePorts,AccessPlan,AccessApplyResult} from '@immedi/iaic-core/context/access-profiles.js';
type Actor={scopeId:string;subjectId:string};
export const open=(ports:AccessProfilePorts<Actor>)=>new AccessProfileReconciler(ports);
export async function approvedMigration(service:AccessProfileReconciler<Actor>,actor:Actor,plan:AccessPlan,approvalId:string):Promise<AccessApplyResult>{
 return service.apply(actor,{plan,approvalId});
}
