/** Host-verified payload normalization; this function does not authenticate webhooks. */
export interface LarkInstallation {
  installationId: string;
  appId: string;
  tenantKey: string;
  botOpenId?: string;
}
export interface LarkRoute {
  provider: 'lark';
  installationId: string;
  conversationId: string;
  senderId: string;
  /** Original root message ID (om_...), not the provider topic ID (omt_...). */
  threadId?: string;
  kind?: 'direct' | 'group';
}
export interface LarkChannelMessage extends LarkRoute {
  eventId: string;
  text: string;
  threadId: string;
  kind: 'direct' | 'group';
}
export function larkMessage(payload: unknown, installation: LarkInstallation): LarkChannelMessage | null;

export interface LarkTextData { msg_type: 'text'; content: string; uuid: string }
export interface LarkCreateRequest {
  params: { receive_id_type: 'chat_id' };
  data: LarkTextData & { receive_id: string };
}
export interface LarkReplyRequest {
  path: { message_id: string };
  data: LarkTextData & { reply_in_thread: true };
}
/** Structural port compatible with the official SDK; no SDK dependency is required. */
export interface LarkSdkResponse { code?: number; data?: { message_id?: string; chat_id?: string } }
export interface LarkSdkClient {
  im: { message: {
    create(input: LarkCreateRequest): LarkSdkResponse | Promise<LarkSdkResponse>;
    /** Required at runtime when the route has a threadId. */
    reply?(input: LarkReplyRequest): LarkSdkResponse | Promise<LarkSdkResponse>;
  } };
}
export interface LarkDeliveryInput {
  idempotencyKey: string;
  message: { text: string };
  signal?: AbortSignal;
}
export type LarkDeliveryResult =
  | { status: 'delivered'; idempotencyKey: string; reference: string }
  | { status: 'not_sent'; idempotencyKey: string; reference: 'local-preflight-denied' }
  | { status: 'unknown'; idempotencyKey: string; reason: 'lark-response-unavailable' | 'lark-receipt-unverified' };
export interface LarkNotificationDelivery {
  allowed: true;
  send(input: LarkDeliveryInput): Promise<LarkDeliveryResult>;
}
export function createLarkNotificationDelivery(options: {
  client: LarkSdkClient;
  route: LarkRoute;
  authorize(route: Readonly<LarkRoute>): boolean | Promise<boolean>;
}): LarkNotificationDelivery;
