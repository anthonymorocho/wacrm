import { describe, expect, it } from 'vitest';

import {
  parseMetaMessagingPayload,
  validateMetaChannelConfig,
  validateMetaChannelProvider,
} from './messaging';

describe('Meta messaging payloads', () => {
  it('normalizes a Messenger text message', () => {
    const [message] = parseMetaMessagingPayload({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'person-1' },
              recipient: { id: 'page-1' },
              timestamp: 1720000000000,
              message: { mid: 'mid-1', text: 'Hola desde Messenger' },
            },
          ],
        },
      ],
    });

    expect(message).toMatchObject({
      provider: 'messenger',
      externalAccountId: 'page-1',
      senderId: 'person-1',
      messageId: 'mid-1',
      contentType: 'text',
      contentText: 'Hola desde Messenger',
      mediaUrl: null,
    });
    expect(message?.timestamp).toBe('2024-07-03T09:46:40.000Z');
  });

  it('normalizes an Instagram text message', () => {
    const [message] = parseMetaMessagingPayload({
      object: 'instagram',
      entry: [
        {
          id: 'instagram-1',
          messaging: [
            {
              sender: { id: 'ig-person-1' },
              timestamp: '1720000000',
              message: { mid: 'ig-mid-1', text: 'Hola desde IG' },
            },
          ],
        },
      ],
    });

    expect(message).toMatchObject({
      provider: 'instagram',
      externalAccountId: 'instagram-1',
      senderId: 'ig-person-1',
      messageId: 'ig-mid-1',
      contentType: 'text',
      contentText: 'Hola desde IG',
    });
    expect(message?.timestamp).toBe('2024-07-03T09:46:40.000Z');
  });

  it('keeps the first supported attachment and its caption', () => {
    const [message] = parseMetaMessagingPayload({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'person-1' },
              timestamp: 1720000000000,
              message: {
                mid: 'mid-image',
                text: 'Foto',
                attachments: [
                  {
                    type: 'image',
                    payload: { url: 'https://cdn.example/image.jpg' },
                  },
                  {
                    type: 'file',
                    payload: { url: 'https://cdn.example/file.pdf' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(message).toMatchObject({
      contentType: 'image',
      contentText: 'Foto',
      mediaUrl: 'https://cdn.example/image.jpg',
    });
  });

  it('ignores echo messages and unsupported webhook shapes', () => {
    const messages = parseMetaMessagingPayload({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'page-1' },
              timestamp: 1720000000000,
              message: { mid: 'echo-1', text: 'our message', is_echo: true },
            },
            {
              sender: { id: 'person-1' },
              timestamp: 1720000000000,
              message: { mid: 'unknown-1', foo: 'bar' },
            },
          ],
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      contentType: 'text',
      contentText: '[Unsupported Meta message]',
    });
  });

  it('skips malformed messages instead of throwing', () => {
    expect(parseMetaMessagingPayload(null)).toEqual([]);
    expect(parseMetaMessagingPayload({ object: 'page' })).toEqual([]);
    expect(
      parseMetaMessagingPayload({
        object: 'page',
        entry: [{ id: '', messaging: [{ message: { mid: 'x' } }] }],
      })
    ).toEqual([]);
  });
});

describe('Meta channel validation', () => {
  it('accepts only the two supported providers', () => {
    expect(validateMetaChannelProvider('instagram')).toBe('instagram');
    expect(validateMetaChannelProvider('messenger')).toBe('messenger');
    expect(validateMetaChannelProvider('whatsapp')).toBeNull();
    expect(validateMetaChannelProvider('page')).toBeNull();
  });

  it('rejects missing, non-string, and oversized credentials', () => {
    expect(() => validateMetaChannelConfig({})).toThrow(/provider/i);
    expect(() =>
      validateMetaChannelConfig({
        provider: 'instagram',
        external_account_id: 'ig-1',
        access_token: 'token',
        app_secret: 'secret',
      })
    ).toThrow(/verify_token/i);
    expect(() =>
      validateMetaChannelConfig({
        provider: 'instagram',
        external_account_id: 'ig-1',
        access_token: 123,
        app_secret: 'secret',
        verify_token: 'verify',
      })
    ).toThrow(/access_token/i);
    expect(() =>
      validateMetaChannelConfig({
        provider: 'instagram',
        external_account_id: 'ig-1',
        access_token: 'x'.repeat(2049),
        app_secret: 'secret',
        verify_token: 'verify',
      })
    ).toThrow(/2048/i);
  });

  it('returns trimmed credentials and optional display name', () => {
    expect(
      validateMetaChannelConfig({
        provider: 'messenger',
        external_account_id: ' page-1 ',
        display_name: ' My Page ',
        access_token: ' token ',
        app_secret: ' secret ',
        verify_token: ' verify ',
      })
    ).toEqual({
      provider: 'messenger',
      external_account_id: 'page-1',
      display_name: 'My Page',
      access_token: 'token',
      app_secret: 'secret',
      verify_token: 'verify',
    });
  });
});
