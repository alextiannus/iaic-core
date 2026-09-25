import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Operations} from './service.js';
export interface DashboardOptions<A> {
 operations:Pick<Operations<A>,'overview'|'agent'>;
 basePath?:string;
 resolveObserver(request:IncomingMessage):Promise<{actor:A;binding:string}|null>;
 authorizeOperator(input:{actor:A;request:IncomingMessage}):boolean|Promise<boolean>;
}
export function createOperationsDashboard<A>(options:DashboardOptions<A>):(request:IncomingMessage,response:ServerResponse)=>Promise<boolean>;
