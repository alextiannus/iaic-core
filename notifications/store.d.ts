export interface NotificationJob {id:string;scopeId:string;requestKey:string;recipientId:string;channel:string;message:Record<string,unknown>;source:Record<string,unknown>;state:string;attempt:string|null;result:unknown}
export class PostgresNotificationStore {
 constructor(options:{pool:any;namespace:string});initialize():Promise<void>;
 enqueue(scopeId:string,input:any):Promise<NotificationJob>;
 get(scopeId:string,requestKey:string):Promise<NotificationJob|null>;
 claim(input?:{leaseSeconds?:number;channel?:string|null;id?:string|null}):Promise<NotificationJob|null>;
 recoverExpired(input?:{channel?:string|null}):Promise<number>;canSend(job:NotificationJob):Promise<boolean>;
 finish(job:NotificationJob,result:any):Promise<NotificationJob>;
 control(scopeId:string,requestKey:string,action:string):Promise<NotificationJob>;
 recoveryPage(input:{channel:string;after?:string|null;limit?:number}):Promise<{items:NotificationJob[];next:string|null}>;
 history(scopeId:string,requestKey:string):Promise<any[]>;
}
