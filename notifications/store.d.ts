export interface NotificationJob {id:string;scopeId:string;requestKey:string;recipientId:string;channel:string;message:Record<string,unknown>;source:Record<string,unknown>;state:string;attempt:string|null;result:unknown}
export class PostgresNotificationStore {
 constructor(options:{pool:any;namespace:string});initialize():Promise<void>;
 enqueue(scopeId:string,input:any):Promise<NotificationJob>;
 get(scopeId:string,requestKey:string):Promise<NotificationJob|null>;
 claim(input?:{leaseSeconds?:number}):Promise<NotificationJob|null>;
 recoverExpired():Promise<number>;canSend(job:NotificationJob):Promise<boolean>;
 finish(job:NotificationJob,result:any):Promise<NotificationJob>;
 control(scopeId:string,requestKey:string,action:string):Promise<NotificationJob>;
 history(scopeId:string,requestKey:string):Promise<any[]>;
}
