export interface ModelBinding {
 modelIdentity: string; endpoint: string;
 /** Opaque Host revision; never the secret or its direct hash. */
 credentialRevision: string;
 /** Current TLS peer identity established by the Host adapter. */
 certificateIdentity: string;
}
export interface ModelVerification {
 binding: ModelBinding; capabilities: readonly string[]; tlsVerified: boolean;
 /** Milliseconds since epoch; finite validity is required. */
 verifiedAt: number; expiresAt: number;
}
export interface ModelReadinessSnapshot {
 active: boolean; binding: ModelBinding; declaredCapabilities: readonly string[];
 verification: ModelVerification | null;
}
export interface ModelReadinessReceipt extends ModelBinding {
 origin: string; capabilities: readonly string[]; verifiedAt: number; expiresAt: number;
}
export interface ReadinessCheck {signal?: AbortSignal | undefined}
export interface ReadinessModel<Request extends ReadinessCheck,Response> {
 name: string; model?: string; profileId?: string; metered?: boolean;
 next(request: Request): Promise<Response>;
}
export function withModelReadiness<Request extends ReadinessCheck,Response>(options: {
 model: ReadinessModel<Request,Response>; binding: ModelBinding; requirements: readonly string[];
 resolve(context: {modelIdentity: string; signal: AbortSignal | undefined}): ModelReadinessSnapshot | Promise<ModelReadinessSnapshot>;
 now?: () => number;
}): ReadinessModel<Request,Response> & {checkReady(options?: ReadinessCheck): Promise<ModelReadinessReceipt>};
export function isModelReadinessError(error: unknown): boolean;
