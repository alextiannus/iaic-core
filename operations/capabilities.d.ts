import type {Operations} from './service.js';
import type {Capability} from '../capabilities/index.js';
export function createOperationsCapabilities<A>(options:{operations:Operations<A>;prefix?:string}):Capability[];
