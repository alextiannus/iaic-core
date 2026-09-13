import {CapabilityHttpClient} from '@immedi/iaic-core/http/client.js';
type Contracts = {'greeting.read': {input: string; output: string}};
const client = new CapabilityHttpClient<Contracts>({url: 'https://example.test/capabilities'});
const reply = await client.invoke('greeting.read', 'developer');
if (reply.resultKind === 'capability-result') reply.result.toUpperCase();
// @ts-expect-error Unknown capability names are rejected.
client.invoke('unknown', 'developer');
// @ts-expect-error The application input contract requires a string.
client.invoke('greeting.read', 42);
