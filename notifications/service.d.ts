import type {PostgresNotificationStore,NotificationJob} from './store.js';
export class Notifications {
 constructor(options:{store:PostgresNotificationStore;resolveScope:(actor:any)=>string|Promise<string>;authorize:(actor:any,context:any)=>boolean|Promise<boolean>;resolveDelivery:(job:NotificationJob)=>any});
 enqueue(actor:any,input:any):Promise<NotificationJob>;
 get(actor:any,input:{requestKey:string}):Promise<NotificationJob|null>;
 history(actor:any,input:{requestKey:string}):Promise<any[]>;
 retry(actor:any,input:{requestKey:string}):Promise<NotificationJob>;
 cancel(actor:any,input:{requestKey:string}):Promise<NotificationJob>;
 tick(input?:{leaseSeconds?:number;signal?:AbortSignal;channel?:string|null;id?:string|null}):Promise<NotificationJob|null>;
 reconcile(actor:any,input:{requestKey:string}):Promise<NotificationJob>;
}
