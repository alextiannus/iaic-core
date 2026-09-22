export interface PendingSupportEvent {scopeId:string;issueId:string;revision:number;state:string}
export class SupportEventConsumer {
 constructor(options:{store:{pendingEvents(consumerId:string,input:{limit:number}):Promise<PendingSupportEvent[]>;acknowledgeEvent(consumerId:string,event:PendingSupportEvent):Promise<void>};consumerId:string;deliver:(event:PendingSupportEvent&{requestKey:string})=>Promise<unknown>});
 tick(input?:{limit?:number}):Promise<{acknowledged:number;failed:PendingSupportEvent[]}>;
}
