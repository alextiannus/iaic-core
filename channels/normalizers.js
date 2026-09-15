import {channelMessage} from './assistant.js';

// Payload normalization is deliberately separate from webhook authentication.
// installationId is host configuration; never take it from an unverified body.
export function telegramMessage(update, {installationId,botUsername}) {
  const m = update?.message;
  if (!m || m.from?.is_bot || m.sender_chat || !m.from || typeof m.text !== 'string') return null;
  if (![update.update_id,m.chat?.id,m.from.id].every(Number.isSafeInteger)) throw new Error('Telegram numeric identifiers required');
  if(!['private','group','supergroup'].includes(m.chat.type))return null;
  if(m.message_thread_id!==undefined&&(!Number.isSafeInteger(m.message_thread_id)||m.message_thread_id<1))throw new Error('Telegram topic identifier required');
  let text=m.text;
  const addressed=/^(\/[a-zA-Z0-9_]+)@([a-zA-Z0-9_]+)(?=\s|$)/.exec(text);
  if(addressed){if(!botUsername||addressed[2].toLowerCase()!==botUsername.toLowerCase())return null;text=addressed[1]+text.slice(addressed[0].length);}
  return channelMessage({provider:'telegram',installationId,eventId:String(update.update_id),
    conversationId:String(m.chat.id),senderId:String(m.from.id),text,
    ...(m.message_thread_id ? {threadId:String(m.message_thread_id)} : {}),
    kind:m.chat.type === 'private' ? 'direct' : 'group'});
}

export function slackMessage(payload, {installationId, teamId}) {
  const m = payload?.event;
  if (payload?.team_id !== teamId) throw Object.assign(new Error('Slack installation team differs'),{statusCode:403});
  if (payload.type !== 'event_callback' || m?.type !== 'message' || m.subtype || m.bot_id || typeof m.text !== 'string') return null;
  return channelMessage({provider:'slack',installationId,eventId:payload.event_id,
    conversationId:m.channel,senderId:m.user,text:m.text,
    ...(m.thread_ts ? {threadId:m.thread_ts} : {}),kind:m.channel_type === 'im' ? 'direct' : 'group'});
}
