import Ajv from 'ajv';
import {preflightResult} from './preflight.js';
import {toolCallLimits} from '../agent/tool-limits.js';

const ajv = new Ajv({ allErrors: true, strict: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
const failure = (message, statusCode = 400, detail = {}) => Object.assign(new Error(message), { statusCode, ...detail });

// Stable JSON Schema IDs describe immutable contracts, not a particular Host instance.
const canonicalSchema = value => JSON.stringify(sortSchema(value));
function sortSchema(value) {
  if (Array.isArray(value)) return value.map(sortSchema);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortSchema(value[key])]));
  return value;
}
function compileSchema(schema) {
  const existing = typeof schema?.$id === 'string' ? ajv.getSchema(schema.$id) : null;
  if (!existing) return ajv.compile(schema);
  if (canonicalSchema(existing.schema) !== canonicalSchema(schema)) {
    throw failure('Schema ID is already bound to a different contract', 409,
      {code: 'CAPABILITY_SCHEMA_CONFLICT', publicCode: 'CAPABILITY_SCHEMA_CONFLICT'});
  }
  return existing;
}

export function defineCapability(definition) {
  if (!definition || !/^[a-z][a-z0-9_.-]*$/.test(definition.name || '')) throw failure('Invalid capability name');
  if (!definition.description || !definition.input || !definition.output || typeof definition.authorize !== 'function') {
    throw failure('Capability requires description, input/output schemas and authorization');
  }
  const implementation = definition.implementation;
  if (implementation?.kind === 'function') {
    if (typeof implementation.execute !== 'function' || implementation.tools || implementation.instructions) {
      throw failure('Function capability must have only a deterministic implementation');
    }
  } else if (implementation?.kind === 'agent') {
    if (implementation.execute || !implementation.instructions || !Array.isArray(implementation.tools)
      || typeof implementation.verify !== 'function') throw failure('Agent capability requires tools, instructions and result verification');
  } else throw failure('Unknown capability implementation kind');
  if (implementation.kind !== 'agent' && implementation.toolCallLimits !== undefined) throw failure('Tool call limits require an Agent capability');
  const limits = toolCallLimits(implementation.toolCallLimits, implementation.tools);
  if (!['read', 'write'].includes(definition.effect)) throw failure('Capability must declare read/write effect');
  if (definition.effect === 'write' && !['idempotent', 'never-replay'].includes(definition.retry)) {
    throw failure('Write capability must declare retry semantics');
  }
  if (definition.preflight !== undefined && (implementation.kind !== 'function' || typeof definition.preflight !== 'function')) throw failure('Preflight must be a deterministic function capability check');
  if (definition.waitReady !== undefined && (implementation.kind !== 'function' || definition.effect !== 'read' || typeof definition.waitReady !== 'function' || typeof definition.revalidate !== 'function')) throw failure('Result waiting requires a read function, readiness predicate and history revalidation');
  if (definition.projectHistoryInput !== undefined && (implementation.kind !== 'function' || typeof definition.projectHistoryInput !== 'function')) throw failure('History input projection must be a deterministic function capability hook');
  // Trusted code defines behavior; immutable schemas are what entrypoints expose.
  const input = structuredClone(definition.input), output = structuredClone(definition.output);
  const validateInput = compileSchema(input), validateOutput = compileSchema(output);
  return Object.freeze({ ...definition, input: freeze(input), output: freeze(output),
    implementation: Object.freeze({ ...implementation, ...(limits ? {toolCallLimits: limits} : {}), ...(implementation.tools ? { tools: Object.freeze([...implementation.tools]) } : {}) }),
    validateInput, validateOutput });
}

export class CapabilityDispatcher {
  constructor({ capabilities, tasks = null, executionPolicy = null, validateActor = (actor,capability) => Boolean(actor?.subjectId && (capability.implementation.kind !== 'agent' || actor.scopeId)) }) {
    if(executionPolicy!==null&&typeof executionPolicy?.check!=='function')throw failure('Execution policy check port required');
    this.executionPolicy=executionPolicy;
    this.capabilities = new Map(); this.tasks = tasks; this.validateActor = validateActor;
    for (const capability of capabilities) {
      if (this.capabilities.has(capability.name)) throw failure(`Duplicate capability: ${capability.name}`);
      this.capabilities.set(capability.name, capability);
    }
    for (const capability of capabilities) {
      if (capability.implementation.kind !== 'agent') continue;
      for (const name of capability.implementation.tools) {
        const target = this.capabilities.get(name);
        if (!target || target.implementation.kind !== 'function') throw failure(`Agent tool must be a deterministic capability: ${name}`);
      }
    }
  }

  async checkPolicy(capability,input,{actor,phase,taskId=null,callId=null}){
    if(!this.executionPolicy)return null;
    const decision=await this.executionPolicy.check({actor,capability,input,phase,taskId,callId});
    if(decision?.allowed!==true||['recordId','revision','reason'].some(key=>typeof decision[key]!=='string'||!decision[key].trim()))throw failure('Execution policy did not return a recorded allowance',503);
    return decision;
  }

  async invoke(name, input, { actor, callId = null, signal = null, allowedCapabilities = null, taskId = null } = {}) {
    const capability = this.capabilities.get(name);
    if (!capability) throw failure('Capability not found', 404);
    if (allowedCapabilities && !allowedCapabilities.includes(name)) throw failure('Capability is outside this task scope', 403);
    if (this.validateActor(actor,capability) !== true) throw failure('Application identity required', 401);
    if (signal?.aborted) throw failure('Execution cancelled', 409);
    const value = structuredClone(input);
    if (!capability.validateInput(value)) throw failure('Capability input is invalid', 400, { validation: structuredClone(capability.validateInput.errors) });
    const identity = freeze(structuredClone(actor));
    if (await capability.authorize(identity, value) !== true) throw failure('Capability access denied', 403);
    if (signal?.aborted) throw failure('Execution cancelled', 409);
    if (taskId !== null && (typeof taskId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(taskId))) throw failure('Invalid host Task reference');
    const context = { actor: identity, callId, signal, ...(taskId === null ? {} : {taskId}) };
    if (capability.implementation.kind === 'agent') {
      if (!this.tasks) throw failure('Persistent task runtime is unavailable', 503);
      await this.checkPolicy(capability,value,{...context,phase:'admission'});
      return this.tasks.create({ capability, input: value, actor: identity, idempotencyKey: callId });
    }
    if (capability.effect === 'write' && !callId) throw failure('Write capability requires a stable call ID');
    // Preflight is read-only application validation, before the side-effect boundary.
    if (capability.preflight) {
      const checked=preflightResult(await capability.preflight(value,context));
      if (!checked.valid) throw failure('Capability input failed preflight before execution'+(checked.feedback?': '+checked.feedback:''),422,
        {preflightRejected:true,...(checked.feedback?{preflightFeedback:checked.feedback}:{})});
    }
    await this.checkPolicy(capability,value,{...context,phase:'function'});
    if (signal?.aborted) throw failure('Execution cancelled', 409);
    let executed = false;
    try {
      executed = true;
      const result = await capability.implementation.execute(value, context);
      if (!capability.validateOutput(result)) throw failure('Capability returned invalid output', 502, { validation: structuredClone(capability.validateOutput.errors) });
      if (capability.verify && await capability.verify(value, result, context) !== true) throw failure('Capability outcome was not verified', 422);
      return result;
    } catch (error) {
      // A failed response/verification after a write does not prove no side effect.
      if (executed && capability.effect === 'write') error.outcomeUnknown = true;
      throw error;
    }
  }

  toolsFor(actor) {
    return Object.fromEntries([...this.capabilities.values()].map(capability => [capability.name, {
      name: capability.name, description: capability.description, inputSchema: capability.input,
      outputSchema: capability.output,
      handler: (input, execution = {}) => this.invoke(capability.name, input, { ...execution, actor })
    }]));
  }
}

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
