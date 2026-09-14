/** Runtime errors remain Error objects with optional structural fields. */
export interface CoreErrorFields {
  statusCode?: number; code?: string; publicCode?: string; outcomeUnknown?: boolean;
  preflightRejected?: boolean; preflightFeedback?: string; validation?: unknown;
  requestKey?: string; recovery?: string;
}
export function publicErrorFields(error: unknown): {code?: string};
