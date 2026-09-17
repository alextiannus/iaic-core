import type {Server} from '@modelcontextprotocol/sdk/server/index.js';
import type {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/** Connect the tested peer SDK's Node HTTP transport without an application cast.
 * SDK 1.30.0 itself has exactOptionalPropertyTypes declaration errors: see README.
 * This is only a connection boundary, not authentication or a transport wrapper.
 */
export function connectCapabilityMcpHttpTransport(server: Server, transport: StreamableHTTPServerTransport): Promise<void>;
