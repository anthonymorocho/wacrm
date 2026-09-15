import type { Message } from '@/types';

export const MESSAGE_NOTIFICATION_CLAIM_TTL_MS = 30_000;

const CLAIMS_STORAGE_KEY = 'wacrm:message-notification-claims';

interface NotificationClaimStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isIncomingMessage(
  message: Pick<Message, 'sender_type'>
): boolean {
  return message.sender_type === 'customer';
}

export function getNotificationPreview(
  message: Pick<Message, 'content_text'>,
  fallback: string,
  maxLength = 160
): string {
  const text = message.content_text?.trim();
  if (!text) return fallback;
  if (text.length <= maxLength) return text;

  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function claimMessageNotification(
  storage: NotificationClaimStorage,
  userId: string,
  messageId: string,
  now = Date.now(),
  ttl = MESSAGE_NOTIFICATION_CLAIM_TTL_MS
): boolean {
  const claimId = `${userId}:${messageId}`;
  let claims: Record<string, number> = {};

  try {
    const stored = storage.getItem(CLAIMS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        claims = Object.fromEntries(
          Object.entries(parsed).filter(
            ([, value]) => typeof value === 'number'
          )
        );
      }
    }

    const previousClaim = claims[claimId];
    if (previousClaim !== undefined && now - previousClaim < ttl) {
      return false;
    }

    for (const [key, timestamp] of Object.entries(claims)) {
      if (now - timestamp >= ttl) delete claims[key];
    }

    claims[claimId] = now;
    storage.setItem(CLAIMS_STORAGE_KEY, JSON.stringify(claims));
    return true;
  } catch {
    // Private browsing and restrictive browser settings can disable
    // localStorage. Notifications should still work; only deduplication is
    // unavailable in that case.
    return true;
  }
}
