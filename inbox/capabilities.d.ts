import type {Inbox} from './service.js';
import type {Capability} from '../capabilities/index.js';
export function createInboxCapabilities<A>(options:{inbox:Inbox<A>;prefix?:string}):Capability[];
