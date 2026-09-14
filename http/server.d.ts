import type {Actor, CapabilityContract, CapabilityDispatcher, MaybePromise} from '../capabilities/index.js';
export interface HttpAccess<A extends Actor = Actor> {actor: A; capabilities: string[]}
/** Host authentication, listening, body limits and transport remain application-owned. */
export function createCapabilityHttpHandler<Contracts extends {[K in keyof Contracts]: CapabilityContract}, A extends Actor = Actor>(options: {
  dispatcher: Pick<CapabilityDispatcher<Contracts,A>,'capabilities'|'invoke'>;
  resolveAccess(request: Request): MaybePromise<HttpAccess<A> | null | undefined>;
  basePath?: string;
}): (request: Request) => Promise<Response>;
