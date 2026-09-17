import type {CoreActor, HostContextPorts, HostTaskContext, HostBinding} from '@immedi/iaic-core/context/host.js';
import type {MaybePromise, RegisteredCapability, InvocationContext, History, VerificationResult, ExecutionPolicyPort, TaskReceipt, Schema} from '@immedi/iaic-core/capabilities/index.js';

/** Structural pg.Pool contract; no runtime or type dependency on pg is imposed. */
export interface DatabaseConnection {
  query(text: string, values?: unknown[]): Promise<{rows: Record<string, unknown>[]; rowCount: number | null}>;
}
export interface DatabaseClient extends DatabaseConnection {
  release(error?: Error | boolean): void;
  on(event: 'error', listener: (error: Error) => void): unknown;
  off(event: 'error', listener: (error: Error) => void): unknown;
}
export interface DatabasePool extends DatabaseConnection {connect(): Promise<DatabaseClient>}
export interface AssistantScope {applicationId: string; assistantId: string; subjectId: string}
export interface Job {
  id: string; purpose: string; role?: string; capabilities: string[];
  configuration: {skills: string[]; knowledge: string[]; tools: string[]};
}
export interface InvocationPolicy {
  toolChoice?: 'auto' | 'required'; parallelToolCalls?: boolean; maxCompletionTokens?: number;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}
export interface ModelProfile {
  id: string; label?: string; provider: 'openai' | 'chat-completions'; model: string;
  credentialRef: string; baseUrl?: string; invocation?: InvocationPolicy;
}
export interface ArtifactReference {path: string; revision: number; digest: string}
export interface WorkInput {
  goal: string; allowedTools: string[]; requiredArtifacts?: string[];
  session?: {id: string; throughSequence: number};
  mandate?: {id: string}; sourceEventKey?: string;
}
export interface WorkResult {summary: string; artifacts: ArtifactReference[]}
export interface ModelRequest {
  messages: {role: string; content: string}[];
  tools: {name: string; description: string; inputSchema: Schema}[];
  outputSchema: Schema; delegationSchema: Schema | null; maxBatchCalls: number;
  signal: AbortSignal; billingContext: {taskId: string; turn: number; capability: string};
}
export type ModelAction =
  | {type: 'call'; name: string; input: Record<string, unknown>}
  | {type: 'batch'; actions: {type: 'call'; name: string; input: Record<string, unknown>}[]}
  | {type: 'wait'; question: string}
  | {type: 'finish'; result: WorkResult};
export type ModelResponse = ModelAction & {
  usage: {inputTokens: number; outputTokens: number; cachedInputTokens?: number; reasoningOutputTokens?: number};
  usageEvidence?: {providerReference?: string; rawUsage?: unknown};
};
export interface AllowancePolicy {
  maximum: number | string;
  price: {revision: string; input: number | string; cachedInput: number | string; output: number | string};
}
/** Ordinary starter composition. Advanced extension modules retain their own contracts. */
export interface ApplicationOptions<A extends CoreActor = CoreActor> {
  pool: DatabasePool; skillRoot: string; job: Job; profiles: ModelProfile[];
  resolveSecret(reference: string): MaybePromise<string | undefined>;
  modelFactory?: (configuration: {apiKey: string; model: string; provider: ModelProfile['provider']; baseUrl: string; invocation?: InvocationPolicy}) => {next(request: ModelRequest): Promise<ModelResponse>};
  tokenPolicies: Record<string, AllowancePolicy>;
  /** Runtime restores only CoreActor. Use hostContext.restoreActor for business fields. */
  authorize: (actor: CoreActor) => MaybePromise<boolean>;
  verifyOutcome: (input: WorkInput, result: WorkResult, context: {actor: CoreActor; history: History}) => MaybePromise<VerificationResult>;
  version: string;
  runtimeLimits?: {maxTurns?: number; maxCalls?: number; maxBatchCalls?: number; modelTimeoutMs?: number; taskTimeoutMs?: number};
  taskCursorKey?: Uint8Array | null; toolCallLimits?: Record<string, number>; enablePlans?: boolean;
  extraCapabilities?: RegisteredCapability[];
  executionPolicy?: ExecutionPolicyPort<CoreActor> | null;
  hostContext?: Omit<HostContextPorts<A>, 'readTask'> | null;
}
export interface TaskState extends TaskReceipt {
  capability: string; input: WorkInput; waiting_reason: string | null; version: string;
}
export interface TaskView extends TaskState {
  result: WorkResult | null; trusted_context: HostBinding | null;
  inputRequest: {question: string; reference: string} | null;
}
export type Transition =
  | {action: 'resume' | 'cancel'; requestKey?: string}
  | {action: 'provide_input'; input: string; requestKey?: string};
export interface RuntimePort {
  readonly ready: boolean;
  state(actor: CoreActor, id: string): Promise<TaskState>;
  get(actor: CoreActor, id: string, options: {history: true}): Promise<TaskView & History>;
  get(actor: CoreActor, id: string, options?: {history?: false}): Promise<TaskView>;
  transition(actor: CoreActor, id: string, request: Transition): Promise<TaskReceipt & {capability: string; version: string; waiting_reason: string | null}>;
  transitionReceipt(actor: CoreActor, id: string, requestKey: string): Promise<Record<string, unknown>>;
  tick(): Promise<TaskState | null>;
  start(intervalMs?: number): void;
  stop(): Promise<void>;
  drain(options?: {timeoutMs?: number}): Promise<{drained: boolean; requiresTermination: boolean}>;
  deploymentState(): Promise<{acceptingTicks: boolean; ownsExecutor: boolean; generation: string | null; ownership: {generation: string | null; state: 'active' | 'draining' | 'released'}; requiresTermination: boolean}>;
}
export interface StarterDispatcher {
  capabilities: Map<string, RegisteredCapability>;
  /** Other capability schemas belong to their modules; narrow results before use. */
  invoke<N extends string>(name: N, input: N extends 'agent.work' ? WorkInput : unknown, context: InvocationContext<CoreActor>): Promise<N extends 'agent.work' ? TaskReceipt : unknown>;
}
export interface Balance {balance: string; reserved: string; available: string; unit: 'credit_minor'}
export interface LedgerPort {
  grant(scope: AssistantScope, input: {reference: string; amount: number | string; evidence: Record<string, unknown>}): Promise<Balance>;
  balance(scope: AssistantScope): Promise<Balance>;
  taskUsage(scope: AssistantScope, taskId: string): Promise<{requests: string; pending: string; platformUnits: string; providerTokens: string; complete: boolean}>;
}
export interface Application<A extends CoreActor = CoreActor> {
  dispatcher: StarterDispatcher; runtime: RuntimePort; hostContext: HostTaskContext<A> | null;
  ledger: LedgerPort; scope(actor: CoreActor): Promise<AssistantScope>;
  start(): void; close(): Promise<void>;
  /** Raw module handles, deliberately opaque until their public module types exist. */
  tasks: unknown; taskListing: unknown; plans: unknown; deferred: unknown; events: unknown;
  eventSubscriptions: unknown; eventTasks: unknown; registry: unknown; memory: unknown;
  workspace: unknown; skills: unknown; knowledge: unknown; knowledgeStore: unknown;
  sessions: unknown; models: unknown; modelRouting: unknown; mandates: unknown;
}
export function openApplication<A extends CoreActor = CoreActor>(options: ApplicationOptions<A>): Promise<Application<A>>;
