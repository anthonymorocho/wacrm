export const META_EMBEDDED_SIGNUP_ORIGIN = 'https://www.facebook.com';

export type EmbeddedSignupMessage =
  | { kind: 'finished'; wabaId: string; phoneNumberId: string }
  | { kind: 'cancelled' }
  | { kind: 'error' };

function isNonEmptyString(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= 2048
  );
}

/**
 * Parse only the message contract documented by Meta's Embedded Signup SDK.
 * The origin check is exact and error text from the cross-origin window is
 * intentionally discarded.
 */
export function parseEmbeddedSignupMessage(
  event: Pick<MessageEvent<unknown>, 'origin' | 'data'>
): EmbeddedSignupMessage | null {
  if (event.origin !== META_EMBEDDED_SIGNUP_ORIGIN) return null;

  let value: unknown = event.data;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null;

  const message = value as Record<string, unknown>;
  if (message.type !== 'WA_EMBEDDED_SIGNUP') return null;

  if (message.event === 'CANCEL') return { kind: 'cancelled' };
  if (message.event === 'ERROR') return { kind: 'error' };
  if (message.event !== 'FINISH') return null;

  const data = message.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return null;
  const payload = data as Record<string, unknown>;
  const wabaId = payload.waba_id;
  const phoneNumberId = payload.phone_number_id;
  if (!isNonEmptyString(wabaId) || !isNonEmptyString(phoneNumberId))
    return null;

  return {
    kind: 'finished',
    wabaId: wabaId.trim(),
    phoneNumberId: phoneNumberId.trim(),
  };
}
