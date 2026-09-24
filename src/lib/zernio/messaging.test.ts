import { describe, expect, it } from 'vitest';

import { parseZernioMessage } from './messaging';

describe('parseZernioMessage', () => {
  it('normalizes an incoming Facebook message for the shared Meta inbox', () => {
    const message = parseZernioMessage({
      event: 'message.received',
      conversation: { id: 'zernio-conversation-1' },
      message: {
        platform: 'facebook',
        direction: 'incoming',
        platformMessageId: 'mid-123',
        text: 'Hola desde Facebook',
        sender: { id: 'customer-7', name: 'Ana' },
        sentAt: '2026-09-17T12:00:00.000Z',
      },
      account: {
        accountId: 'zernio-account-1',
        profileId: 'zernio-profile-1',
      },
    });

    expect(message).toEqual({
      provider: 'messenger',
      externalAccountId: 'zernio-account-1',
      senderId: 'customer-7',
      senderName: 'Ana',
      externalConversationId: 'zernio-conversation-1',
      messageId: 'mid-123',
      timestamp: '2026-09-17T12:00:00.000Z',
      contentType: 'text',
      contentText: 'Hola desde Facebook',
      mediaUrl: null,
    });
  });

  it('maps Facebook file attachments without persisting an expiring CDN URL', () => {
    const message = parseZernioMessage({
      event: 'message.received',
      message: {
        platform: 'facebook',
        direction: 'incoming',
        platformMessageId: 'mid-file',
        text: null,
        attachments: [{ type: 'file', url: 'https://cdn.example/file.pdf' }],
        sender: { id: 'customer-8', username: 'ana_8' },
        sentAt: '2026-09-17T12:00:00Z',
      },
      account: {
        accountId: 'zernio-account-1',
        profileId: 'zernio-profile-1',
      },
    });

    expect(message).toMatchObject({
      contentType: 'document',
      contentText: '[Facebook file]',
      mediaUrl: null,
      senderName: 'ana_8',
    });
  });

  it('normalizes an incoming Instagram attachment for the shared Meta inbox', () => {
    expect(parseZernioMessage({
      event: 'message.received',
      conversation: { id: 'instagram-conversation-1' },
      message: {
        platform: 'instagram', direction: 'incoming',
        platformMessageId: 'ig-mid-1', text: null,
        attachments: [{ type: 'image', url: 'https://cdn.example/photo.jpg' }],
        sender: { id: 'ig-user-1', username: 'ana_ig' },
        sentAt: '2026-09-17T12:00:00Z',
      },
      account: { accountId: 'ig-account-1', profileId: 'profile-1' },
    })).toMatchObject({
      provider: 'instagram', externalAccountId: 'ig-account-1',
      externalConversationId: 'instagram-conversation-1',
      senderId: 'ig-user-1', senderName: 'ana_ig',
      contentType: 'image', contentText: '[Instagram image]', mediaUrl: null,
    });
  });

  it.each([
    [
      'an unsupported platform',
      { event: 'message.received', message: { platform: 'tiktok' } },
    ],
    [
      'an outgoing message',
      {
        event: 'message.received',
        message: { platform: 'facebook', direction: 'outgoing' },
      },
    ],
    [
      'an unrelated event',
      {
        event: 'account.connected',
        message: { platform: 'facebook', direction: 'incoming' },
      },
    ],
  ])('ignores %s', (_label, payload) => {
    expect(parseZernioMessage(payload)).toBeNull();
  });
});
