import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const zernio = vi.hoisted(() => ({
  sendZernioInboxMessage: vi.fn(),
  listZernioInboxConversations: vi.fn(),
}));
const credentials = vi.hoisted(() => ({
  getZernioCredentials: vi.fn(),
}));
const connections = vi.hoisted(() => ({
  getZernioConnection: vi.fn(),
  getZernioConnectionForChannel: vi.fn(),
}));

vi.mock('@/lib/zernio/client', () => zernio);
vi.mock('@/lib/zernio/profile', () => credentials);
vi.mock('@/lib/zernio/connection', () => connections);
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
  sendInteractiveButtons: vi.fn(),
  sendInteractiveList: vi.fn(),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((value: string) => value),
  encrypt: vi.fn((value: string) => value),
  isLegacyFormat: vi.fn(() => false),
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: vi.fn(() => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const method of ['update', 'eq', 'select']) {
        builder[method] = vi.fn(chain);
      }
      builder.then = (resolve: (value: unknown) => unknown) =>
        resolve({ data: null, error: null });
      return builder;
    },
  })),
}));

import { sendMessageToConversation } from '@/lib/whatsapp/send-message';

const conversation = {
  id: 'crm-conversation-1',
  account_id: 'account-1',
  channel: 'messenger',
  channel_id: 'channel-1',
  zernio_conversation_id: 'zernio-conversation-1',
  contact: {
    id: 'contact-1',
    phone: null,
    name: 'Ana',
  },
};

function makeDatabase(
  options: {
    conversation?: Record<string, unknown>;
    participantId?: string;
    channelSource?: 'meta' | 'zernio';
    channelExternalAccountId?: string;
  } = {}
) {
  const messageInserts: Record<string, unknown>[] = [];
  const conversationUpdates: Record<string, unknown>[] = [];

  const db = {
    from(table: string) {
      let operation: 'select' | 'insert' | 'update' = 'select';
      let payload: Record<string, unknown> | null = null;
      const builder: Record<string, unknown> = {};
      const chain = () => builder;

      builder.select = vi.fn(chain);
      builder.eq = vi.fn(chain);
      builder.order = vi.fn(chain);
      builder.limit = vi.fn(chain);
      builder.insert = vi.fn((value: Record<string, unknown>) => {
        operation = 'insert';
        payload = value;
        if (table === 'messages') messageInserts.push(value);
        return builder;
      });
      builder.update = vi.fn((value: Record<string, unknown>) => {
        operation = 'update';
        payload = value;
        if (table === 'conversations') conversationUpdates.push(value);
        return builder;
      });

      const result = () => {
        if (table === 'conversations' && operation === 'select') {
          return { data: options.conversation ?? conversation, error: null };
        }
        if (table === 'meta_contact_identities' && operation === 'select') {
          return {
            data: options.participantId
              ? { external_user_id: options.participantId }
              : null,
            error: null,
          };
        }
        if (table === 'meta_channels' && operation === 'select') {
          return {
            data: {
              integration_source: options.channelSource ?? 'zernio',
              provider: 'messenger',
              status: 'connected',
              external_account_id:
                options.channelExternalAccountId ?? 'facebook-page-1',
            },
            error: null,
          };
        }
        if (table === 'messages' && operation === 'insert') {
          return { data: { id: 'crm-message-1' }, error: null };
        }
        return { data: null, error: null };
      };

      builder.single = vi.fn(async () => result());
      builder.maybeSingle = vi.fn(async () => result());
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
      ) => Promise.resolve(result()).then(resolve, reject);
      void payload;
      return builder;
    },
  };

  return {
    db: db as unknown as SupabaseClient,
    messageInserts,
    conversationUpdates,
  };
}

describe('sendMessageToConversation — Zernio Messenger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentials.getZernioCredentials.mockResolvedValue({
      apiKey: 'private-zernio-api-key',
      webhookSecret: 'private-webhook-secret',
    });
    connections.getZernioConnection.mockResolvedValue({
      account_id: 'account-1',
      provider: 'messenger',
      zernio_account_id: 'zernio-account-1',
      status: 'connected',
    });
    connections.getZernioConnectionForChannel.mockResolvedValue({
      account_id: 'account-1',
      provider: 'messenger',
      zernio_account_id: 'zernio-account-1',
      status: 'connected',
    });
    zernio.sendZernioInboxMessage.mockResolvedValue({
      messageId: 'zernio-message-1',
      conversationId: 'zernio-conversation-1',
    });
  });

  it('sends text through Zernio and persists it in the CRM', async () => {
    const { db, messageInserts, conversationUpdates } = makeDatabase();

    const result = await sendMessageToConversation(db, 'account-1', {
      conversationId: 'crm-conversation-1',
      messageType: 'text',
      contentText: 'Hola, ¿en qué podemos ayudarte?',
      senderId: 'agent-1',
    });

    expect(zernio.sendZernioInboxMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'private-zernio-api-key',
        accountId: 'zernio-account-1',
        conversationId: 'zernio-conversation-1',
        message: 'Hola, ¿en qué podemos ayudarte?',
      })
    );
    expect(messageInserts[0]).toMatchObject({
      conversation_id: 'crm-conversation-1',
      sender_type: 'agent',
      sender_id: 'agent-1',
      content_type: 'text',
      content_text: 'Hola, ¿en qué podemos ayudarte?',
      message_id: 'zernio-message-1',
      channel: 'messenger',
      channel_id: 'channel-1',
      status: 'sent',
    });
    expect(conversationUpdates[0]).toMatchObject({
      last_message_text: 'Hola, ¿en qué podemos ayudarte?',
    });
    expect(result).toEqual({
      messageId: 'crm-message-1',
      whatsappMessageId: 'zernio-message-1',
    });
  });

  it('rebinds a legacy Messenger conversation to the active Zernio channel', async () => {
    const { db, messageInserts, conversationUpdates } = makeDatabase({
      conversation: { ...conversation, channel_id: 'legacy-channel' },
      channelSource: 'meta',
    });
    connections.getZernioConnection.mockResolvedValue({
      account_id: 'account-1',
      meta_channel_id: 'zernio-channel-1',
      facebook_page_id: 'facebook-page-1',
      zernio_account_id: 'zernio-account-1',
      status: 'connected',
    });

    await sendMessageToConversation(db, 'account-1', {
      conversationId: 'crm-conversation-1',
      messageType: 'text',
      contentText: 'Respuesta desde Zernio',
    });

    expect(conversationUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel_id: 'zernio-channel-1' }),
      ])
    );
    expect(messageInserts[0]).toMatchObject({
      channel: 'messenger',
      channel_id: 'zernio-channel-1',
    });
  });

  it('recovers the provider conversation id for an older CRM thread', async () => {
    const { db, conversationUpdates } = makeDatabase({
      conversation: { ...conversation, zernio_conversation_id: null },
      participantId: 'customer-1',
    });
    zernio.listZernioInboxConversations.mockResolvedValue([
      {
        id: 'zernio-conversation-recovered',
        accountId: 'zernio-account-1',
        platform: 'facebook',
        participantId: 'customer-1',
      },
    ]);

    await sendMessageToConversation(db, 'account-1', {
      conversationId: 'crm-conversation-1',
      messageType: 'text',
      contentText: 'Mensaje para un hilo antiguo',
    });

    expect(zernio.listZernioInboxConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'private-zernio-api-key',
        accountId: 'zernio-account-1',
        platform: 'facebook',
      })
    );
    expect(conversationUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          zernio_conversation_id: 'zernio-conversation-recovered',
        }),
      ])
    );
    expect(zernio.sendZernioInboxMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'zernio-conversation-recovered',
      })
    );
  });

  it('rejects non-text messages on Zernio Messenger before sending', async () => {
    const { db } = makeDatabase();

    await expect(
      sendMessageToConversation(db, 'account-1', {
        conversationId: 'crm-conversation-1',
        messageType: 'image',
        mediaUrl: 'https://example.com/image.jpg',
      })
    ).rejects.toMatchObject({
      code: 'unsupported_message_type',
      status: 400,
    });
    expect(zernio.sendZernioInboxMessage).not.toHaveBeenCalled();
  });
});
