import { describe, expect, it } from 'vitest';

import {
  claimMessageNotification,
  getNotificationPreview,
  isIncomingMessage,
} from './incoming-message';

describe('incoming message notifications', () => {
  it('only treats customer messages as incoming notifications', () => {
    expect(isIncomingMessage({ sender_type: 'customer' })).toBe(true);
    expect(isIncomingMessage({ sender_type: 'agent' })).toBe(false);
    expect(isIncomingMessage({ sender_type: 'bot' })).toBe(false);
  });

  it('uses trimmed message text and falls back for media messages', () => {
    expect(
      getNotificationPreview({ content_text: '  Hola  ' }, 'Nuevo mensaje')
    ).toBe('Hola');
    expect(
      getNotificationPreview({ content_text: '   ' }, 'Nuevo mensaje')
    ).toBe('Nuevo mensaje');
  });

  it('claims each message once per user until the claim expires', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(
      claimMessageNotification(storage, 'user-1', 'message-1', 1_000)
    ).toBe(true);
    expect(
      claimMessageNotification(storage, 'user-1', 'message-1', 1_001)
    ).toBe(false);
    expect(
      claimMessageNotification(storage, 'user-2', 'message-1', 1_001)
    ).toBe(true);
    expect(
      claimMessageNotification(storage, 'user-1', 'message-1', 32_001)
    ).toBe(true);
  });
});
