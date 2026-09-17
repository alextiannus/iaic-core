import type {Server} from '@modelcontextprotocol/sdk/server/index.js';
import type {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {RequestHandlerExtra} from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {Implementation, ServerRequest, ServerNotification} from '@modelcontextprotocol/sdk/types.js';
import type {Actor, CapabilityContract, CapabilityDispatcher, MaybePromise} from '../capabilities/index.js';

/** SDK request context, including AuthInfo supplied by trusted Host middleware.
 * Core does not authenticate tokens. Never construct authority from tool arguments.
 */
export type McpAccessContext = RequestHandlerExtra<ServerRequest, ServerNotification>;
export interface McpAccess<A extends Actor = Actor> {actor: A; capabilities: string[]}
export function createCapabilityMcpServer<Contracts extends {[K in keyof Contracts]: CapabilityContract}, A extends Actor = Actor>(options: {
  dispatcher: Pick<CapabilityDispatcher<Contracts,A>, 'capabilities' | 'invoke'>;
  /** Re-evaluated on every discovery and call; the Dispatcher also authorizes execution. */
  resolveAccess(extra: McpAccessContext): MaybePromise<McpAccess<A> | null | undefined>;
  serverInfo?: Implementation;
}): Server;

/** Connect the tested peer SDK's Node HTTP transport without an application cast.
 * SDK 1.30.0 itself has exactOptionalPropertyTypes declaration errors: see README.
 * This is only a connection boundary, not authentication or a transport wrapper.
 */
export function connectCapabilityMcpHttpTransport(server: Server, transport: StreamableHTTPServerTransport): Promise<void>;
