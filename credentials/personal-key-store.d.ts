import type {PersonalKeyStore,PersonalKeyRecord} from './personal-keys.js';
export interface PersonalKeyQueryPort { query(text:string,values?:unknown[]):Promise<{rows:Record<string,any>[]}>; }
export class PostgresPersonalKeyStore implements PersonalKeyStore {
 constructor(options:{namespace:string;pool:PersonalKeyQueryPort & {connect():Promise<PersonalKeyQueryPort & {release():void}>}});
 namespace:string;
 initialize():Promise<void>;
 get(id:string):Promise<PersonalKeyRecord|null>;
 insert(value:PersonalKeyRecord,replaceId?:string|null):Promise<void>;
 list(accountId:string,page?:{after?:string;limit?:number}):Promise<PersonalKeyRecord[]>;
 revoke(accountId:string,id:string,at:string):Promise<PersonalKeyRecord|null>;
}
