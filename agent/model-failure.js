// Stable allow-listed model failures; never derive user diagnostics from provider text.
const reasons=Object.freeze({MODEL_OUTPUT_LIMIT:'model_output_limit',MODEL_TIMEOUT:'model_timeout',MODEL_PROVIDER_ERROR:'provider_error',INVALID_MODEL_ACTION:'invalid_model_action'});
export const modelFailureReason=error=>Object.hasOwn(reasons,error?.code)?reasons[error.code]:null;
