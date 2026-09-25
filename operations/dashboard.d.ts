import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Operations} from './service.js';
export interface DashboardOptions<A> {
 operations:Pick<Operations<A>,'overview'|'agent'>;
 basePath?:string;
 refreshMs?:number;
 feedback?:{list(actor:A,input:{id:string}):Promise<Array<{id:string;state:string;summary:string}>>;report(actor:A,input:{id:string;requestKey:string;summary:string}):Promise<{id:string;state:string;summary:string}>}|null;
 authorizeMutation?(input:{actor:A;request:IncomingMessage}):boolean|Promise<boolean>;
 resolveObserver(request:IncomingMessage):Promise<{actor:A;binding:string}|null>;
 authorizeOperator(input:{actor:A;request:IncomingMessage}):boolean|Promise<boolean>;
}
export function createOperationsDashboard<A>(options:DashboardOptions<A>):(request:IncomingMessage,response:ServerResponse)=>Promise<boolean>;
