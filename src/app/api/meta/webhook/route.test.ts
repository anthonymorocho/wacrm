import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callbacks: (() => Promise<void>)[] = [];
const nextServer = vi.hoisted(() => ({
  after: vi.fn((callback: () => Promise<void>) => {
    callbacks.push(callback);
  }),
}));
const metaClient = vi.hoisted(() => ({
  createClient: vi.fn(),
}));
const inbound = vi.hoisted(() => ({
  processNormalizedMetaMessage: vi.fn().mockResolvedValue('inserted'),
}));

vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: nextServer.after };
});
vi.mock('@supabase/supabase-js', () => metaClient);
vi.mock('@/lib/meta/inbound', () => inbound);

import { encrypt } from '@/lib/whatsapp/encryption';
import { GET, POST } from './route';

let rows: Record<string, unknown>[] = [];

function setupAdmin() {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.then = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  const admin = { from: vi.fn(() => builder) };
  metaClient.createClient.mockReturnValue(admin);
  return admin;
}

function channelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'channel-1',
    account_id: 'account-1',
    user_id: 'user-1',
    provider: 'messenger',
    external_account_id: 'page-1',
    display_name: 'Acme Page',
    status: 'connected',
    access_token: encrypt('page-token'),
    app_secret: encrypt('app-secret'),
    verify_token: encrypt('verify-me'),
    connected_at: '2026-09-16T10:00:00.000Z',
    created_at: '2026-09-16T10:00:00.000Z',
    updated_at: '2026-09-16T10:00:00.000Z',
    ...overrides,
  };
}

function signedRequest(payload: unknown, secret = 'app-secret') {
  const raw = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(raw)
    .digest('hex');
  return new Request('http://localhost/api/meta/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': `sha256=${signature}`,
    },
    body: raw,
  });
}

const messengerPayload = {
  object: 'page',
  entry: [
    {
      id: 'page-1',
      messaging: [
        {
          sender: { id: 'person-1' },
          recipient: { id: 'page-1' },
          timestamp: 1720000000000,
          message: { mid: 'mid-1', text: 'Hola' },
        },
      ],
    },
  ],
};

describe('/api/meta/webhook', () => {
  beforeEach(() => {
    rows = [];
    callbacks.length = 0;
    vi.clearAllMocks();
    inbound.processNormalizedMetaMessage.mockResolvedValue('inserted');
    setupAdmin();
  });

  it('returns Meta challenge when the encrypted verify token matches', async () => {
    rows = [channelRow()];

    const response = await GET(
      new Request(
        'http://localhost/api/meta/webhook?hub.mode=subscribe&hub.challenge=challenge-1&hub.verify_token=verify-me'
      )
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('challenge-1');
  });

  it('rejects a wrong verify token', async () => {
    rows = [channelRow()];

    const response = await GET(
      new Request(
        'http://localhost/api/meta/webhook?hub.mode=subscribe&hub.challenge=challenge-1&hub.verify_token=wrong'
      )
    );

    expect(response.status).toBe(403);
  });

  it('rejects a POST with an invalid signature before scheduling work', async () => {
    rows = [channelRow()];
    const request = new Request('http://localhost/api/meta/webhook', {
      method: 'POST',
      headers: { 'x-hub-signature-256': 'sha256=invalid' },
      body: JSON.stringify(messengerPayload),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(nextServer.after).not.toHaveBeenCalled();
  });

  it('acknowledges and processes a signed Messenger message asynchronously', async () => {
    rows = [channelRow()];

    const response = await POST(signedRequest(messengerPayload));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'received' });
    expect(nextServer.after).toHaveBeenCalledTimes(1);

    await callbacks.shift()?.();

    expect(inbound.processNormalizedMetaMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'channel-1',
        provider: 'messenger',
        account_id: 'account-1',
      }),
      expect.objectContaining({
        provider: 'messenger',
        externalAccountId: 'page-1',
        senderId: 'person-1',
        messageId: 'mid-1',
      })
    );
  });

  it('ignores entries for an unknown channel', async () => {
    rows = [channelRow()];
    const payload = {
      ...messengerPayload,
      entry: [{ ...messengerPayload.entry[0], id: 'unknown-page' }],
    };

    const response = await POST(signedRequest(payload));
    expect(response.status).toBe(200);
    await callbacks.shift()?.();
    expect(inbound.processNormalizedMetaMessage).not.toHaveBeenCalled();
  });

  it('does not schedule echo messages as inbound messages', async () => {
    rows = [channelRow()];
    const payload = {
      ...messengerPayload,
      entry: [
        {
          ...messengerPayload.entry[0],
          messaging: [
            {
              ...messengerPayload.entry[0].messaging[0],
              sender: { id: 'page-1' },
              message: { mid: 'echo-1', text: 'our reply', is_echo: true },
            },
          ],
        },
      ],
    };

    const response = await POST(signedRequest(payload));
    expect(response.status).toBe(200);
    await callbacks.shift()?.();
    expect(inbound.processNormalizedMetaMessage).not.toHaveBeenCalled();
  });

  it('requires the matched channel secret for an entry', async () => {
    rows = [
      channelRow(),
      channelRow({
        id: 'channel-2',
        external_account_id: 'page-2',
        app_secret: encrypt('other-secret'),
      }),
    ];
    const payload = {
      ...messengerPayload,
      entry: [{ ...messengerPayload.entry[0], id: 'page-2' }],
    };

    // This signature is valid for channel-1, but not for page-2's channel.
    const response = await POST(signedRequest(payload));
    expect(response.status).toBe(200);
    await callbacks.shift()?.();
    expect(inbound.processNormalizedMetaMessage).not.toHaveBeenCalled();
  });
});
