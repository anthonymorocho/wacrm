import type { Conversation } from '@/types';

/** Channels supported by the shared Inbox. */
export type InboxChannel = NonNullable<Conversation['channel']>;

/**
 * Normalize persisted conversation channels at the UI boundary.
 *
 * Rows created before social messaging was added have no channel column in
 * their serialized payload, so they must continue to render as WhatsApp.
 */
export function normalizeInboxChannel(value: unknown): InboxChannel {
  if (value === 'instagram' || value === 'messenger') return value;
  return 'whatsapp';
}

/** Translation key used by the shared Inbox.channel message group. */
export function getInboxChannelLabelKey(value: unknown): InboxChannel {
  return normalizeInboxChannel(value);
}
