import type { ContentType } from '@/types';

export type MetaChannelProvider = 'instagram' | 'messenger';

export interface MetaChannelConfigInput {
  provider: MetaChannelProvider;
  external_account_id: string;
  display_name?: string;
  access_token: string;
  app_secret: string;
  verify_token: string;
}

export interface NormalizedMetaMessage {
  provider: MetaChannelProvider;
  externalAccountId: string;
  senderId: string;
  senderName: string | null;
  /** Provider conversation id, when the upstream payload exposes one. */
  externalConversationId?: string | null;
  messageId: string;
  timestamp: string;
  contentType: ContentType;
  contentText: string | null;
  mediaUrl: string | null;
}

const MAX_CONFIG_VALUE_LENGTH = 2048;

type MetaRecord = Record<string, unknown>;

function isRecord(value: unknown): value is MetaRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function validateMetaChannelProvider(
  value: unknown
): MetaChannelProvider | null {
  return value === 'instagram' || value === 'messenger' ? value : null;
}

function readConfigString(input: MetaRecord, field: string): string {
  const value = input[field];
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }

  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  if (trimmed.length > MAX_CONFIG_VALUE_LENGTH) {
    throw new Error(
      `${field} must be at most ${MAX_CONFIG_VALUE_LENGTH} characters`
    );
  }
  return trimmed;
}

export function validateMetaChannelConfig(
  input: unknown
): MetaChannelConfigInput {
  if (!isRecord(input)) throw new Error('Configuration must be an object');

  const provider = validateMetaChannelProvider(input.provider);
  if (!provider) throw new Error('provider must be instagram or messenger');

  const displayName = input.display_name;
  if (displayName !== undefined && typeof displayName !== 'string') {
    throw new Error('display_name must be a string');
  }

  const result: MetaChannelConfigInput = {
    provider,
    external_account_id: readConfigString(input, 'external_account_id'),
    access_token: readConfigString(input, 'access_token'),
    app_secret: readConfigString(input, 'app_secret'),
    verify_token: readConfigString(input, 'verify_token'),
  };

  if (typeof displayName === 'string' && displayName.trim()) {
    if (displayName.trim().length > MAX_CONFIG_VALUE_LENGTH) {
      throw new Error(
        `display_name must be at most ${MAX_CONFIG_VALUE_LENGTH} characters`
      );
    }
    result.display_name = displayName.trim();
  }

  return result;
}

function toIsoTimestamp(value: unknown): string | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  // Messenger and Instagram use milliseconds, while accepting seconds here
  // keeps the normalizer tolerant of fixtures and older Meta event samples.
  const milliseconds = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function attachmentContentType(value: unknown): ContentType | null {
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

function normalizeMessagingEvent(
  provider: MetaChannelProvider,
  externalAccountId: string,
  event: unknown
): NormalizedMetaMessage | null {
  if (!isRecord(event)) return null;
  const sender = isRecord(event.sender) ? event.sender : null;
  const message = isRecord(event.message) ? event.message : null;
  if (!sender || !message || message.is_echo === true) return null;

  const senderId = nonEmptyString(sender.id);
  const messageId = nonEmptyString(message.mid);
  const timestamp = toIsoTimestamp(event.timestamp);
  if (!senderId || !messageId || !timestamp) return null;

  const text = typeof message.text === 'string' ? message.text : null;
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
    : [];
  const attachment = isRecord(attachments[0]) ? attachments[0] : null;
  const attachmentType = attachmentContentType(attachment?.type);
  const attachmentPayload = isRecord(attachment?.payload)
    ? attachment.payload
    : null;
  const attachmentUrl = nonEmptyString(attachmentPayload?.url);

  let contentType: ContentType = 'text';
  let contentText = text;
  let mediaUrl: string | null = null;

  if (attachmentType) {
    contentType = attachmentType;
    mediaUrl = attachmentUrl;
    contentText = text || nonEmptyString(attachmentPayload?.title);
  } else if (!text) {
    contentText = '[Unsupported Meta message]';
  }

  return {
    provider,
    externalAccountId,
    senderId,
    senderName: nonEmptyString(sender.name),
    messageId,
    timestamp,
    contentType,
    contentText,
    mediaUrl,
  };
}

export function parseMetaMessagingPayload(
  payload: unknown
): NormalizedMetaMessage[] {
  if (!isRecord(payload)) return [];

  const provider =
    payload.object === 'page'
      ? 'messenger'
      : payload.object === 'instagram'
        ? 'instagram'
        : null;
  if (!provider || !Array.isArray(payload.entry)) return [];

  const normalized: NormalizedMetaMessage[] = [];
  for (const entry of payload.entry) {
    if (!isRecord(entry)) continue;
    const externalAccountId = nonEmptyString(entry.id);
    if (!externalAccountId || !Array.isArray(entry.messaging)) continue;

    for (const event of entry.messaging) {
      const message = normalizeMessagingEvent(
        provider,
        externalAccountId,
        event
      );
      if (message) normalized.push(message);
    }
  }

  return normalized;
}
