export type MaybePromise<T> = T | Promise<T>;
export interface Actor {subjectId: string; scopeId?: string}
export type Schema = object | true;
export interface CapabilityContract<Input = unknown, Output = unknown> {input: Input; output: Output}
export interface InvocationContext<A extends Actor = Actor> {
  actor: A; callId?: string | null; signal?: AbortSignal | null;
  allowedCapabilities?: string[] | null; taskId?: string | null;
}
export interface ExecutionContext<A extends Actor = Actor> {
  actor: Readonly<A>; callId: string | null; signal: AbortSignal | null; taskId?: string;
}
export interface TaskReceipt {
  id: string; status: 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
  [field: string]: unknown;
}
export interface History {
  calls: Array<{capability: string; status: string; input: unknown; result?: unknown; [field: string]: unknown}>;
  events: Array<{kind: string; data: unknown; [field: string]: unknown}>;
}
export type PreflightResult = boolean | {valid: boolean; feedback?: string};
export type VerificationResult = boolean | {verified: boolean; feedback?: string};
export interface FunctionImplementation<I, O, A extends Actor> {
  kind: 'function'; execute(input: I, context: ExecutionContext<A>): MaybePromise<O>;
}
export interface AgentImplementation<I, O, A extends Actor> {
  kind: 'agent'; instructions: string; tools: string[]; toolCallLimits?: Record<string, number>;
  verify(input: I, result: O, context: {actor: Readonly<A>; history: History}): MaybePromise<VerificationResult>;
}
type Effect = {effect: 'read'; retry?: 'idempotent' | 'never-replay'} | {effect: 'write'; retry: 'idempotent' | 'never-replay'};
export type CapabilityDefinition<I = unknown, O = unknown, A extends Actor = Actor> = Effect & {
  name: string; description: string; input: Schema; output: Schema;
  authorize(actor: Readonly<A>, input: I): MaybePromise<boolean>;
  implementation: FunctionImplementation<I,O,A> | AgentImplementation<I,O,A>;
  preflight?: (input: I, context: ExecutionContext<A>) => MaybePromise<PreflightResult>;
  verify?: (input: I, result: O, context: ExecutionContext<A>) => MaybePromise<boolean>;
  revalidate?: (input: I, previous: O, context: {actor: Readonly<A>; callId?: string}) => MaybePromise<O>;
  waitReady?: (input: I, result: O, context: {actor: Readonly<A>}) => MaybePromise<boolean>;
  projectHistoryInput?: (input: I, context: {actor: Readonly<A>; callId: string; status: string}) => MaybePromise<Record<string,unknown>>;
};
declare const registered: unique symbol;
/** A contract compiled by defineCapability; descriptor access does not execute it. */
export interface RegisteredCapability {
  readonly [registered]: true;
  readonly name: string; readonly description: string; readonly input: Schema; readonly output: Schema;
  readonly effect: 'read' | 'write'; readonly retry?: 'idempotent' | 'never-replay';
  readonly implementation: {readonly kind: 'function' | 'agent'};
}
export type Capability<I = unknown,O = unknown,A extends Actor = Actor> = Readonly<CapabilityDefinition<I,O,A>> & RegisteredCapability & {
  validateInput: ((value: unknown) => value is I) & {errors?: readonly unknown[] | null};
  validateOutput: ((value: unknown) => value is O) & {errors?: readonly unknown[] | null};
};
export function defineCapability<I = unknown,O = unknown,A extends Actor = Actor>(definition: CapabilityDefinition<I,O,A>): Capability<I,O,A>;

export interface TaskCreationPort<A extends Actor = Actor> {
  create(request: {capability: RegisteredCapability; input: unknown; actor: Readonly<A>; idempotencyKey: string | null}): MaybePromise<TaskReceipt>;
}
export interface ExecutionPolicyPort<A extends Actor = Actor> {
  check(request: {actor: Readonly<A>; capability: RegisteredCapability; input: unknown; phase: 'admission' | 'function'; taskId?: string | null; callId?: string | null}): MaybePromise<{allowed: boolean; recordId: string; revision: string; reason: string}>;
}
export class CapabilityDispatcher<Contracts extends {[K in keyof Contracts]: CapabilityContract} = Record<string,CapabilityContract>, A extends Actor = Actor> {
  constructor(options: {capabilities: readonly RegisteredCapability[]; tasks?: TaskCreationPort<A> | null; executionPolicy?: ExecutionPolicyPort<A> | null; validateActor?: (actor: A, capability: RegisteredCapability) => boolean});
  capabilities: Map<string,RegisteredCapability>;
  invoke<K extends keyof Contracts & string>(name: K, input: Contracts[K]['input'], context: InvocationContext<A>): Promise<Contracts[K]['output']>;
  toolsFor(actor: A): Record<string,{name: string; description: string; inputSchema: Schema; outputSchema: Schema; handler(input: unknown, context?: Omit<InvocationContext<A>,'actor'>): Promise<unknown>}>;
}
