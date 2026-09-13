import {defineCapability} from '../capabilities/index.js';

const failure = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
// Preserve MCP content, including non-text resources. Hosts may project it later.
const resultSchema = {type: 'object', properties: {
  content: {type: 'array', items: {type: 'object'}},
  structuredContent: {type: 'object'}, isError: {type: 'boolean'}, _meta: {type: 'object'}
}, required: ['content'], additionalProperties: true};

export async function discoverMcpTools(client, {signal, maxPages = 100} = {}) {
  if (typeof client?.listTools !== 'function' || !Number.isInteger(maxPages) || maxPages < 1) throw failure('MCP discovery requires a connected client and positive page limit');
  const tools = new Map(), cursors = new Set();
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const result = await client.listTools(cursor === undefined ? {} : {cursor}, {signal});
    if (!Array.isArray(result.tools)) throw failure('Invalid MCP tool catalog', 502);
    for (const tool of result.tools) {
      if (!tool || typeof tool.name !== 'string' || !tool.name || !tool.inputSchema || tools.has(tool.name)) throw failure('Invalid or duplicate MCP tool definition', 502);
      tools.set(tool.name, structuredClone(tool));
    }
    cursor = result.nextCursor;
    if (cursor === undefined) return [...tools.values()];
    if (typeof cursor !== 'string' || !cursor || cursors.has(cursor)) throw failure('Invalid or repeated MCP catalog cursor', 502);
    cursors.add(cursor);
  }
  throw failure('MCP discovery page limit reached; catalog was not imported', 502);
}

// Discovery describes tools. Only trusted host bindings grant local exposure,
// assign effects and choose the credentials used for each execution.
export async function importMcpCapabilities({client, resolveClient, bindings, signal}) {
  if (typeof resolveClient !== 'function' || !Array.isArray(bindings)) throw failure('MCP import requires bindings and a current client resolver');
  const catalog = new Map((await discoverMcpTools(client, {signal})).map(tool => [tool.name, tool]));
  const names = new Set();
  return bindings.map(binding => {
    const {name, tool: toolName, effect, authorize, toArguments, input, description, verify} = binding;
    const retry = binding.retry ?? (effect === 'write' ? 'never-replay' : undefined);
    if (names.has(name)) throw failure('Duplicate imported capability name');
    names.add(name);
    const tool = catalog.get(toolName);
    if (!tool) throw failure('Selected MCP tool was not discovered');
    if (toArguments !== undefined && typeof toArguments !== 'function') throw failure('toArguments must be a trusted host function');
    if (toArguments && !input) throw failure('Argument mapping requires an explicit local input schema');
    if (retry === 'idempotent' && !toArguments) throw failure('Idempotent imports require explicit stable-key argument mapping');
    const capability = defineCapability({name, description: description || tool.description || `Call ${toolName}`, input: input || tool.inputSchema,
      output: resultSchema, effect, ...(retry ? {retry} : {}), authorize,
      ...(verify ? {verify} : {}),
      implementation: {kind: 'function', execute: async (value, context) => {
        const current = await resolveClient({...context, tool: toolName, capability: name});
        if (typeof current?.callTool !== 'function') throw failure('MCP connection is unavailable', 503);
        const args = toArguments ? await toArguments(value, context) : value;
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw failure('MCP arguments must be an object');
        if (context.signal?.aborted) throw failure('Execution cancelled', 409);
        const result = await current.callTool({name: toolName, arguments: args}, undefined, {signal: context.signal});
        if (result.isError === true) {
          const error = failure('Remote MCP tool reported failure', 502);
          // Retain evidence for the host; transport adapters need not disclose it.
          error.remoteResult = structuredClone(result);
          throw error;
        }
        return result;
      }}});
    return capability;
  });
}
