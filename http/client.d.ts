export interface CapabilityContract<Input = unknown, Output = unknown> { input: Input; output: Output }
export interface CallOptions { requestKey?: string; signal?: AbortSignal }
export interface CapabilityDescription { name: string; description: string; input: object; output: object; effect: 'read' | 'write'; retry: string | null; requestKeyRequired: boolean; resultKind: 'task-receipt' | 'capability-result' }
export type CapabilityResponse<T> = { resultKind: 'capability-result'; result: T } | { resultKind: 'task-receipt'; result: unknown };
export class CapabilityHttpError extends Error { code?: string; statusCode?: number; outcomeUnknown?: boolean; requestKey?: string; recovery?: string; validation?: unknown }
export class CapabilityHttpClient<Contracts extends {[K in keyof Contracts]: CapabilityContract} = Record<string, CapabilityContract>> {
  constructor(options: {url: string; fetch?: typeof fetch; headers?: () => HeadersInit | Promise<HeadersInit>});
  list(options?: {signal?: AbortSignal}): Promise<CapabilityDescription[]>;
  invoke<K extends keyof Contracts & string>(name: K, input: Contracts[K]['input'], options?: CallOptions): Promise<CapabilityResponse<Contracts[K]['output']>>;
}
