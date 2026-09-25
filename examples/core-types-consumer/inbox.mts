import {Inbox} from '@immedi/iaic-core/inbox/service.js';
import {PostgresInboxStore} from '@immedi/iaic-core/inbox/store.js';
import type {InboxStore,InboxItem} from '@immedi/iaic-core/inbox/store.js';
import {createInboxCapabilities} from '@immedi/iaic-core/inbox/capabilities.js';
type Actor={subjectId:string;tenant:string;workspace:string;market:string};
export function compose(store:InboxStore) {
 const inbox=new Inbox<Actor>({store,resolveScope:a=>JSON.stringify([a.subjectId,a.tenant,a.workspace,a.market]),authorize:(_a,c)=>c.action!=='receive',resolveProjection:()=>({send:async()=>({status:'unknown'}),query:async()=>({status:'delivered',reference:'receipt'})})});
 const capabilities=createInboxCapabilities({inbox});
 const list=(actor:Actor)=>inbox.list(actor,{limit:10});
 const get=(actor:Actor,id:string):Promise<InboxItem>=>inbox.get(actor,id);
 return {inbox,capabilities,list,get};
}
if(typeof PostgresInboxStore!=='function'||typeof Inbox!=='function')throw Error('Missing Inbox exports');
console.log(JSON.stringify({inboxTypes:true,subpathImports:true}));
