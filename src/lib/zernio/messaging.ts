import type { ContentType } from '@/types';

export interface NormalizedZernioMessage {
  provider: 'messenger';
  externalAccountId: string;
  senderId: string;
  senderName: string | null;
  messageId: string;
  timestamp: string;
  contentType: ContentType;
  contentText: string | null;
  mediaUrl: string | null;
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function attachmentType(value: unknown): ContentType | null {
  switch (value) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'file':
      return 'document';
    default:
      return null;
  }
}

/**
 * Normalize one Zernio inbox event into the contract used by the existing
 * Meta inbound pipeline. Facebook attachment URLs are intentionally not
 * persisted: Zernio documents them as expiring CDN URLs.
 */
export function parseZernioMessage(
  payload: unknown
): NormalizedZernioMessage | null {
  if (!isRecord(payload) || payload.event !== 'message.received') return null;

  const account = isRecord(payload.account) ? payload.account : null;
  const message = isRecord(payload.message) ? payload.message : null;
  if (!account || !message) return null;

  if (message.platform !== 'facebook' || message.direction !== 'incoming') {
    return null;
  }

  const externalAccountId = nonEmptyString(account.accountId);
  const sender = isRecord(message.sender) ? message.sender : null;
  const senderId = nonEmptyString(sender?.id);
  const messageId = nonEmptyString(message.platformMessageId);
  const timestamp = normalizeTimestamp(message.sentAt);
  if (!externalAccountId || !senderId || !messageId || !timestamp) return null;

  const text = typeof message.text === 'string' ? message.text : null;
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
    : [];
  const firstAttachment = isRecord(attachments[0]) ? attachments[0] : null;
  const contentType = attachmentType(firstAttachment?.type) ?? 'text';
  const attachmentLabel = nonEmptyString(firstAttachment?.type);
  const contentText =
    text ||
    (attachmentLabel ? `[Facebook ${attachmentLabel}]` : '[Facebook message]');

  return {
    provider: 'messenger',
    externalAccountId,
    senderId,
    senderName:
      nonEmptyString(sender?.name) ?? nonEmptyString(sender?.username),
    messageId,
    timestamp,
    contentType,
    contentText,
    mediaUrl: null,
  };
}
