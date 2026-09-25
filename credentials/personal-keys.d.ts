export interface PersonalKeyActor { subjectId:string; organizationId:string|null; scopeId:string; personalCredentialId?:string; }
export interface PersonalKeyMetadata { id:string; accountId:string; organizationId:string|null; label:string; capabilities:string[]; createdAt:string; expiresAt:string; revokedAt:string|null; }
export interface PersonalKeyRecord extends PersonalKeyMetadata { digest:string; requestKey:string; }
export interface PersonalKeyInput { label:string; capabilities:readonly string[]; expiresAt:string; requestKey:string; }
export interface PersonalKeyStore { namespace:string; get(id:string):Promise<PersonalKeyRecord|null>; insert(value:PersonalKeyRecord,replaceId?:string|null):Promise<void>; list(accountId:string,page:{after:string;limit:number}):Promise<PersonalKeyRecord[]>; revoke(accountId:string,id:string,at:string):Promise<PersonalKeyRecord|null>; }
export interface PersonalKeyAccess { actor:PersonalKeyActor; capabilities:string[]; }
export class PersonalApiKeys<C=unknown> {
 constructor(options:{store:PersonalKeyStore;directory:{namespace:string;current(actor:PersonalKeyActor):Promise<C>};authorizeManagement(context:{actor:PersonalKeyActor;current:C;action:'issue'|'rotate'|'list'|'revoke'}):boolean|Promise<boolean>;resolveCapabilities(context:{actor:PersonalKeyActor;current:C}):readonly string[]|Promise<readonly string[]>;clock?:()=>Date});
 issue(actor:PersonalKeyActor,input:PersonalKeyInput):Promise<{credential:PersonalKeyMetadata;token:string}>;
 rotate(actor:PersonalKeyActor,id:string,input:PersonalKeyInput):Promise<{credential:PersonalKeyMetadata;token:string}>;
 list(actor:PersonalKeyActor,page?:{after?:string;limit?:number}):Promise<PersonalKeyMetadata[]>;
 revoke(actor:PersonalKeyActor,id:string):Promise<PersonalKeyMetadata>;
 authenticate(token:string):Promise<PersonalKeyAccess>;
 check(actor:PersonalKeyActor,capability:string):Promise<true>;
}
