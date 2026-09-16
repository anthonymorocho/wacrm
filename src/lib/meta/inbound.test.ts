import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const routing = vi.hoisted(() => ({
  routeAfterInboundMessage: vi.fn().mockResolvedValue(undefined),
}));
const deals = vi.hoisted(() => ({
  createSupabaseInboundDealRepository: vi.fn(() => ({})),
  ensureInboundDeal: vi
    .fn()
    .mockResolvedValue({ created: true, dealId: 'deal-1' }),
}));

vi.mock('@/lib/conversations/route-event', () => routing);
vi.mock('@/lib/pipelines/inbound-deal', () => deals);

import { processNormalizedMetaMessage } from './inbound';
import type { MetaChannel } from '@/types';
import type { NormalizedMetaMessage } from './messaging';

type Result = { data?: unknown; error?: unknown };

function fakeDatabase(results: Record<string, Result[]>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const db = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of [
        'select',
        'eq',
        'order',
        'limit',
        'insert',
        'update',
        'delete',
      ]) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }

      const next = () => results[table]?.shift() ?? { data: null, error: null };
      builder.maybeSingle = () => {
        calls.push({ table, method: 'maybeSingle', args: [] });
        return Promise.resolve(next());
      };
      builder.single = () => {
        calls.push({ table, method: 'single', args: [] });
        return Promise.resolve(next());
      };
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
      ) => Promise.resolve(next()).then(resolve, reject);
      return builder;
    },
  };

  return { db: db as unknown as SupabaseClient, calls };
}

const channel: MetaChannel = {
  id: 'channel-1',
  account_id: 'account-1',
  user_id: 'user-1',
  provider: 'instagram',
  external_account_id: 'ig-account-1',
  display_name: 'Acme Instagram',
  status: 'connected',
  connected_at: '2026-09-16T10:00:00.000Z',
  created_at: '2026-09-16T10:00:00.000Z',
  updated_at: '2026-09-16T10:00:00.000Z',
};

const message: NormalizedMetaMessage = {
  provider: 'instagram',
  externalAccountId: 'ig-account-1',
  senderId: 'person-1',
  senderName: 'Ana',
  messageId: 'ig-mid-1',
  timestamp: '2026-09-16T10:01:00.000Z',
  contentType: 'text',
  contentText: 'Hola',
  mediaUrl: null,
};

const contact = { id: 'contact-1', name: 'Ana', phone: null };
const conversation = { id: 'conversation-1', status: 'open', unread_count: 2 };

describe('processNormalizedMetaMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routing.routeAfterInboundMessage.mockResolvedValue(undefined);
    deals.createSupabaseInboundDealRepository.mockReturnValue({});
    deals.ensureInboundDeal.mockResolvedValue({
      created: true,
      dealId: 'deal-1',
    });
  });

  it('creates the social identity, contact, conversation, and message', async () => {
    const { db, calls } = fakeDatabase({
      meta_contact_identities: [
        { data: null, error: null },
        { data: { contact_id: contact.id }, error: null },
      ],
      contacts: [{ data: contact, error: null }],
      conversations: [
        { data: null, error: null },
        { data: conversation, error: null },
        { data: null, error: null },
      ],
      messages: [{ data: null, error: null }],
    });

    const result = await processNormalizedMetaMessage(db, channel, message);

    expect(result).toBe('inserted');
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'contacts',
          method: 'insert',
          args: [
            expect.objectContaining({
              account_id: 'account-1',
              user_id: 'user-1',
              phone: null,
              name: 'Ana',
            }),
          ],
        }),
        expect.objectContaining({
          table: 'meta_contact_identities',
          method: 'insert',
          args: [
            expect.objectContaining({
              channel_id: 'channel-1',
              external_user_id: 'person-1',
              contact_id: 'contact-1',
            }),
          ],
        }),
        expect.objectContaining({
          table: 'conversations',
          method: 'insert',
          args: [
            expect.objectContaining({
              account_id: 'account-1',
              contact_id: 'contact-1',
              channel: 'instagram',
              channel_id: 'channel-1',
            }),
          ],
        }),
        expect.objectContaining({
          table: 'messages',
          method: 'insert',
          args: [
            expect.objectContaining({
              conversation_id: 'conversation-1',
              sender_type: 'customer',
              content_type: 'text',
              content_text: 'Hola',
              message_id: 'ig-mid-1',
              channel: 'instagram',
              channel_id: 'channel-1',
              status: 'delivered',
            }),
          ],
        }),
      ])
    );
    expect(routing.routeAfterInboundMessage).toHaveBeenCalledWith(
      db,
      'account-1'
    );
    expect(deals.ensureInboundDeal).toHaveBeenCalled();
  });

  it('reuses the identity and existing contact on the next message', async () => {
    const { db, calls } = fakeDatabase({
      meta_contact_identities: [
        { data: { contact_id: contact.id }, error: null },
      ],
      contacts: [{ data: contact, error: null }],
      conversations: [
        { data: [conversation], error: null },
        { data: null, error: null },
      ],
      messages: [{ data: null, error: null }],
    });

    expect(await processNormalizedMetaMessage(db, channel, message)).toBe(
      'inserted'
    );
    expect(
      calls.some(
        (call) => call.table === 'contacts' && call.method === 'insert'
      )
    ).toBe(false);
    expect(
      calls.some(
        (call) => call.table === 'conversations' && call.method === 'insert'
      )
    ).toBe(false);
  });

  it('treats a repeated provider message id as a successful duplicate', async () => {
    const { db, calls } = fakeDatabase({
      meta_contact_identities: [
        { data: { contact_id: contact.id }, error: null },
      ],
      contacts: [{ data: contact, error: null }],
      conversations: [{ data: [conversation], error: null }],
      messages: [
        { data: null, error: { code: '23505', message: 'duplicate' } },
      ],
    });

    expect(await processNormalizedMetaMessage(db, channel, message)).toBe(
      'duplicate'
    );
    expect(
      calls.some(
        (call) => call.table === 'conversations' && call.method === 'update'
      )
    ).toBe(false);
    expect(routing.routeAfterInboundMessage).not.toHaveBeenCalled();
  });

  it('keeps all contact and conversation lookups account-scoped', async () => {
    const { db, calls } = fakeDatabase({
      meta_contact_identities: [
        { data: { contact_id: contact.id }, error: null },
      ],
      contacts: [{ data: contact, error: null }],
      conversations: [
        { data: [conversation], error: null },
        { data: null, error: null },
      ],
      messages: [{ data: null, error: null }],
    });

    await processNormalizedMetaMessage(db, channel, message);

    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'contacts',
          method: 'eq',
          args: ['account_id', 'account-1'],
        }),
        expect.objectContaining({
          table: 'conversations',
          method: 'eq',
          args: ['account_id', 'account-1'],
        }),
      ])
    );
  });
});
