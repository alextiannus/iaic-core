export interface AccessGrants {permissions:string[];mandates:string[]}
export interface AccessProfileReference {id:string;version:string}
export interface AccessProfile extends AccessProfileReference,AccessGrants {}
export interface AccessIdentity {scopeId:string;principalId:string;role:string;market:string}
export interface AccessSnapshot {
 contextId:string;revision:string;policyRevision:string;identity:AccessIdentity;
 profile:AccessProfile;overrides:{grant:AccessGrants;revoke:AccessGrants};effective:AccessGrants;denied:AccessGrants;eligible:true;
}
export interface AccessRevision {identity:AccessIdentity;profile:AccessProfile;overrides:{grant:AccessGrants;revoke:AccessGrants};effective:AccessGrants}
export interface AccessPlanEntry {
 contextId:string;before:AccessSnapshot;after:AccessRevision;changed:boolean;
 changes:{permissions:{add:string[];retain:string[];remove:string[]};mandates:{add:string[];retain:string[];remove:string[]}};
}
export interface AccessPlan {schema:'iaic.access-profile-plan.v1';target:AccessProfile;entries:AccessPlanEntry[];digest:string}
export interface AccessReceipt {contextId:string;operationKey:string;planDigest:string;previousRevision:string;revision:string}
export interface AccessAppendRequest<A> {actor:A;contextId:string;operationKey:string;planDigest:string;approvalId:string;expected:AccessSnapshot;next:AccessRevision}
type MaybePromise<T>=T|Promise<T>;
export interface AccessProfilePorts<A> {
 authorize(request:{actor:A;action:'preview'|'apply';contextId:string}):MaybePromise<boolean>;
 resolveProfile(request:{actor:A;profile:AccessProfileReference}):MaybePromise<AccessProfile>;
 readContext(request:{actor:A;contextId:string}):MaybePromise<AccessSnapshot>;
 approve(request:{actor:A;approvalId:string;digest:string}):MaybePromise<boolean>;
 readReceipt(request:{actor:A;contextId:string;operationKey:string}):MaybePromise<AccessReceipt|null>;
 appendRevision(request:AccessAppendRequest<A>):MaybePromise<AccessReceipt>;
}
export interface AccessApplyResult {
 digest:string;complete:boolean;results:Array<{contextId:string;operationKey:string;status:'applied'|'unchanged'|'blocked'|'unknown';revision?:string;code?:string}>;
}
export class AccessProfileReconciler<A=unknown> {
 constructor(ports:AccessProfilePorts<A>);
 preview(actor:A,request:{profile:AccessProfileReference;contextIds:string[]}):Promise<AccessPlan>;
 apply(actor:A,request:{plan:AccessPlan;approvalId:string}):Promise<AccessApplyResult>;
}
