import type {SupportStore,SupportIssue,SupportEvent} from './service.js';
export class PostgresSupportStore implements SupportStore {
 constructor(options:{pool:any;namespace:string}); initialize():Promise<void>;
 create(scope:string,reporter:string,input:{requestKey:string;report:Record<string,string>}):Promise<SupportIssue>;
 get(scope:string,id:string):Promise<SupportIssue|null>;
 list(scope:string,input?:{reporterId?:string;limit?:number}):Promise<SupportIssue[]>;
 history(scope:string,id:string):Promise<SupportEvent[]>;
 change(scope:string,id:string,input:Record<string,unknown>):Promise<SupportIssue>;
}
