import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const zernio = vi.hoisted(() => ({
  getZernioConnectionForChannel: vi.fn(), getZernioCredentials: vi.fn(),
  listZernioInboxConversations: vi.fn(), sendZernioInboxMessage: vi.fn(),
}));
vi.mock('@/lib/zernio/connection', () => ({
  getZernioConnection: vi.fn(),
  getZernioConnectionForChannel: zernio.getZernioConnectionForChannel,
}));
vi.mock('@/lib/zernio/profile', () => ({ getZernioCredentials: zernio.getZernioCredentials }));
vi.mock('@/lib/zernio/client', () => ({
  listZernioInboxConversations: zernio.listZernioInboxConversations,
  sendZernioInboxMessage: zernio.sendZernioInboxMessage,
}));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({ from: vi.fn(() => ({
  update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
  then: (resolve: (value: unknown) => void) => resolve({ error: null }),
})) }) }));

import {
  buildAgentMessageInsert,
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';

// A db that explodes if touched — these tests cover the param
// validation that MUST short-circuit before any query runs.
function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error('db should not be queried for invalid params');
    },
  } as unknown as SupabaseClient;
}

async function expectSendError(
  params: SendMessageParams,
  status: number,
  messageMatch?: RegExp
) {
  await expect(
    sendMessageToConversation(noDb(), 'acct-1', params)
  ).rejects.toBeInstanceOf(SendMessageError);
  await sendMessageToConversation(noDb(), 'acct-1', params).catch(
    (e: SendMessageError) => {
      expect(e.status).toBe(status);
      if (messageMatch) expect(e.message).toMatch(messageMatch);
    }
  );
}

describe('sendMessageToConversation — param validation (pre-DB)', () => {
  const base = { conversationId: 'cv-1' };

  it('requires conversation_id and message_type', async () => {
    await expectSendError({ conversationId: '', messageType: 'text' }, 400);
    await expectSendError({ conversationId: 'cv-1', messageType: '' }, 400);
  });

  it('rejects an unsupported message_type', async () => {
    await expectSendError(
      { ...base, messageType: 'carrier-pigeon' },
      400,
      /Unsupported message_type/
    );
  });

  it('requires content_text for text messages', async () => {
    await expectSendError(
      { ...base, messageType: 'text' },
      400,
      /content_text is required/
    );
  });

  it('requires template_name for template messages', async () => {
    await expectSendError(
      { ...base, messageType: 'template' },
      400,
      /template_name is required/
    );
  });

  it('requires media_url for media kinds', async () => {
    for (const kind of ['image', 'video', 'document', 'audio']) {
      await expectSendError(
        { ...base, messageType: kind },
        400,
        /media_url is required/
      );
    }
  });

  it('rejects an over-long media caption (non-audio)', async () => {
    await expectSendError(
      {
        ...base,
        messageType: 'image',
        mediaUrl: 'https://x/y.jpg',
        contentText: 'a'.repeat(1025),
      },
      400,
      /1024-character limit/
    );
  });

  it('requires a valid interactive payload for interactive messages', async () => {
    // Missing payload entirely.
    await expectSendError(
      { ...base, messageType: 'interactive' },
      400,
      /payload is required/
    );
    // Too many buttons.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
            { id: 'c', title: 'C' },
            { id: 'd', title: 'D' },
          ],
        },
      },
      400,
      /at most 3 buttons/
    );
    // Over-long button title.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [{ id: 'a', title: 'x'.repeat(21) }],
        },
      },
      400,
      /20-character limit/
    );
  });

  it('allows a long "caption" on audio (audio carries none) — so it reaches the DB', async () => {
    // Audio is exempt from the caption cap, so validation passes and we
    // proceed to the conversation lookup — proven by the stub throwing.
    const spy = vi.fn(() => {
      throw new Error('reached DB');
    });
    const db = { from: spy } as unknown as SupabaseClient;
    await expect(
      sendMessageToConversation(db, 'acct-1', {
        ...base,
        messageType: 'audio',
        mediaUrl: 'https://x/y.ogg',
        contentText: 'a'.repeat(2000),
      })
    ).rejects.toThrow('reached DB');
    expect(spy).toHaveBeenCalledWith('conversations');
  });
});

describe('SendMessageError', () => {
  it('carries a machine code and an HTTP status', () => {
    const e = new SendMessageError('meta_error', 'boom', 502);
    expect(e.code).toBe('meta_error');
    expect(e.status).toBe(502);
    expect(e).toBeInstanceOf(Error);
  });
});

describe('buildAgentMessageInsert', () => {
  it('persists the authenticated sender for every manual message type', () => {
    const common = {
      conversationId: 'conv-1',
      senderId: 'agent-1',
      whatsappMessageId: 'wamid-1',
      replyToMessageId: null,
    };

    expect(
      buildAgentMessageInsert({
        ...common,
        messageType: 'text',
        contentText: 'Hi',
      })
    ).toMatchObject({
      sender_type: 'agent',
      sender_id: 'agent-1',
      content_type: 'text',
    });
    expect(
      buildAgentMessageInsert({
        ...common,
        messageType: 'template',
        templateName: 'hello',
      })
    ).toMatchObject({
      sender_type: 'agent',
      sender_id: 'agent-1',
      content_type: 'template',
    });
    expect(
      buildAgentMessageInsert({
        ...common,
        messageType: 'image',
        mediaUrl: 'https://example.com/a.jpg',
      })
    ).toMatchObject({
      sender_type: 'agent',
      sender_id: 'agent-1',
      content_type: 'image',
    });
    expect(
      buildAgentMessageInsert({
        ...common,
        messageType: 'interactive',
        contentText: 'Choose',
        interactivePayload: {
          kind: 'buttons',
          body: 'Choose',
          buttons: [{ id: 'yes', title: 'Yes' }],
        },
      })
    ).toMatchObject({
      sender_type: 'agent',
      sender_id: 'agent-1',
      content_type: 'interactive',
    });
  });
});

describe('Zernio social replies', () => {
  function database(channel: 'instagram' | 'messenger', storedId: string | null = 'thread-1') {
    const conversation = {
      id: 'conv-1', account_id: 'acct-1', channel, channel_id: 'channel-1',
      zernio_conversation_id: storedId, contact: { id: 'contact-1' },
    };
    const writes: Array<{ table: string; value: unknown }> = [];
    const db = { from: vi.fn((table: string) => {
      const builder = {
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
        insert: vi.fn((value: unknown) => { writes.push({ table, value }); return builder; }),
        update: vi.fn((value: unknown) => { writes.push({ table, value }); return builder; }),
        single: vi.fn().mockResolvedValue({ data: table === 'conversations' ? conversation : { id: 'saved-1' }, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: table === 'meta_channels'
            ? { provider: channel, integration_source: 'zernio', status: 'connected' }
            : { external_user_id: 'participant-1' }, error: null,
        }),
        then: (resolve: (value: unknown) => void) => resolve({ error: null }),
      };
      return builder;
    }) } as unknown as SupabaseClient;
    return { db, writes };
  }

  it('sends an Instagram text reply through the conversation channel account', async () => {
    vi.clearAllMocks();
    const { db, writes } = database('instagram');
    zernio.getZernioConnectionForChannel.mockResolvedValue({
      provider: 'instagram', status: 'connected', zernio_account_id: 'ig-account-1',
      meta_channel_id: 'channel-1',
    });
    zernio.getZernioCredentials.mockResolvedValue({ apiKey: 'key' });
    zernio.sendZernioInboxMessage.mockResolvedValue({ messageId: 'ig-mid-1' });

    await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'conv-1', messageType: 'text', contentText: 'Hola',
    });
    expect(zernio.getZernioConnectionForChannel).toHaveBeenCalledWith(
      expect.anything(), 'acct-1', 'channel-1'
    );
    expect(zernio.sendZernioInboxMessage).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'ig-account-1', conversationId: 'thread-1', message: 'Hola',
    }));
    expect(writes).toContainEqual({ table: 'messages', value: expect.objectContaining({
      channel: 'instagram', channel_id: 'channel-1', message_id: 'ig-mid-1',
    }) });
  });

  it('keeps Messenger replies on the Facebook Zernio account', async () => {
    vi.clearAllMocks();
    const { db } = database('messenger');
    zernio.getZernioConnectionForChannel.mockResolvedValue({
      provider: 'messenger', status: 'connected', zernio_account_id: 'fb-account-1',
      meta_channel_id: 'channel-1',
    });
    zernio.getZernioCredentials.mockResolvedValue({ apiKey: 'key' });
    zernio.sendZernioInboxMessage.mockResolvedValue({ messageId: 'fb-mid-1' });

    await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'conv-1', messageType: 'text', contentText: 'Hola',
    });
    expect(zernio.sendZernioInboxMessage).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'fb-account-1', conversationId: 'thread-1', message: 'Hola',
    }));
  });

  it('recovers an Instagram conversation only from the Instagram account and platform', async () => {
    vi.clearAllMocks();
    const { db } = database('instagram', null);
    zernio.getZernioConnectionForChannel.mockResolvedValue({
      provider: 'instagram', status: 'connected', zernio_account_id: 'ig-account-1',
      meta_channel_id: 'channel-1',
    });
    zernio.getZernioCredentials.mockResolvedValue({ apiKey: 'key' });
    zernio.listZernioInboxConversations.mockResolvedValue([
      { id: 'wrong', accountId: 'ig-account-1', platform: 'facebook', participantId: 'participant-1' },
      { id: 'ig-thread', accountId: 'ig-account-1', platform: 'instagram', participantId: 'participant-1' },
    ]);
    zernio.sendZernioInboxMessage.mockResolvedValue({ messageId: 'ig-mid-1' });

    await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'conv-1', messageType: 'text', contentText: 'Hola',
    });
    expect(zernio.listZernioInboxConversations).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'ig-account-1', platform: 'instagram',
    }));
    expect(zernio.sendZernioInboxMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'ig-thread',
    }));
  });

  it('rejects media replies and a connection for a different provider', async () => {
    vi.clearAllMocks();
    const { db } = database('instagram');
    zernio.getZernioConnectionForChannel.mockResolvedValue({
      provider: 'messenger', status: 'connected', zernio_account_id: 'fb-account-1',
    });
    zernio.getZernioCredentials.mockResolvedValue({ apiKey: 'key' });
    await expect(sendMessageToConversation(db, 'acct-1', {
      conversationId: 'conv-1', messageType: 'text', contentText: 'Hola',
    })).rejects.toMatchObject({ code: 'zernio_not_configured' });
    await expect(sendMessageToConversation(db, 'acct-1', {
      conversationId: 'conv-1', messageType: 'image', mediaUrl: 'https://example.com/a.jpg',
    })).rejects.toMatchObject({ code: 'unsupported_message_type' });
    expect(zernio.sendZernioInboxMessage).not.toHaveBeenCalled();
  });
});
