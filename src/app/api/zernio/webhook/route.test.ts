import crypto from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const callbacks: (() => Promise<void>)[] = [];
const nextServer = vi.hoisted(() => ({
  after: vi.fn((callback: () => Promise<void>) => {
    callbacks.push(callback);
  }),
}));
const database = vi.hoisted(() => ({
  from: vi.fn(),
}));
const inbound = vi.hoisted(() => ({
  processZernioEvent: vi.fn().mockResolvedValue('inserted'),
}));
const profiles = vi.hoisted(() => ({
  listZernioWebhookSecrets: vi.fn(),
}));

vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: nextServer.after };
});
vi.mock('@/lib/meta/admin-client', () => ({
  supabaseAdmin: () => ({ from: database.from }),
}));
vi.mock('@/lib/zernio/inbound', () => inbound);
vi.mock('@/lib/zernio/profile', () => profiles);

import { POST } from './route';

const payload = {
  id: 'event-1',
  event: 'message.received',
  message: {
    platform: 'facebook',
    direction: 'incoming',
    platformMessageId: 'mid-1',
    text: 'Hola',
    sender: { id: 'customer-1', name: 'Ana' },
    sentAt: '2026-09-17T12:00:00.000Z',
  },
  account: { accountId: 'zernio-account-1', profileId: 'zernio-profile-1' },
};

function signedRequest(body: unknown, secret = 'zernio-secret') {
  const raw = JSON.stringify(body);
  const eventId =
    typeof body === 'object' && body !== null && 'id' in body
      ? String((body as { id: unknown }).id)
      : payload.id;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(raw)
    .digest('hex');
  return new Request('http://localhost/api/zernio/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Zernio-Signature': signature,
      'X-Zernio-Event-Id': eventId,
    },
    body: raw,
  });
}

describe('/api/zernio/webhook', () => {
  const builder = {
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
  };

  beforeEach(() => {
    callbacks.length = 0;
    vi.clearAllMocks();
    builder.insert.mockResolvedValue({ error: null });
    builder.update.mockReturnValue(builder);
    builder.eq.mockResolvedValue({ error: null });
    database.from.mockReturnValue(builder);
    inbound.processZernioEvent.mockResolvedValue('inserted');
    profiles.listZernioWebhookSecrets.mockResolvedValue([
      { profileId: 'zernio-profile-1', webhookSecret: 'zernio-secret' },
    ]);
  });

  it('acknowledges a signed event and processes it after the response', async () => {
    const response = await POST(signedRequest(payload));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'received' });
    expect(nextServer.after).toHaveBeenCalledTimes(1);
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'event-1',
        event: 'message.received',
        payload,
      })
    );

    await callbacks.shift()?.();
    expect(inbound.processZernioEvent).toHaveBeenCalledWith(payload);
  });

  it('rejects an invalid signature before persisting or scheduling work', async () => {
    const response = await POST(signedRequest(payload, 'wrong-secret'));

    expect(response.status).toBe(401);
    expect(builder.insert).not.toHaveBeenCalled();
    expect(nextServer.after).not.toHaveBeenCalled();
  });

  it('treats a repeated event id as an already-acknowledged delivery', async () => {
    builder.insert.mockResolvedValueOnce({ error: { code: '23505' } });

    const response = await POST(signedRequest(payload));

    expect(response.status).toBe(200);
    expect(nextServer.after).not.toHaveBeenCalled();
  });

  it('does not let one account secret authenticate another profile', async () => {
    profiles.listZernioWebhookSecrets.mockResolvedValue([
      { profileId: 'zernio-profile-1', webhookSecret: 'zernio-secret' },
      { profileId: 'zernio-profile-2', webhookSecret: 'other-secret' },
    ]);

    const response = await POST(signedRequest(payload, 'other-secret'));

    expect(response.status).toBe(401);
    expect(builder.insert).not.toHaveBeenCalled();
  });

  it('persists and schedules a signed Facebook comment event', async () => {
    const commentPayload = {
      ...payload,
      id: 'comment-event-1',
      event: 'comment.received',
      comment: {
        id: 'comment-1',
        postId: null,
        platformPostId: 'facebook-post-1',
        platform: 'facebook',
        text: 'Hola',
        author: { id: 'customer-1', name: 'Ana' },
        createdAt: '2026-09-17T12:00:00.000Z',
        isReply: false,
        parentCommentId: null,
      },
      post: {
        id: null,
        platformPostId: 'facebook-post-1',
        content: 'Publicación',
        imageUrl: null,
        permalink: null,
      },
    };

    const response = await POST(signedRequest(commentPayload));

    expect(response.status).toBe(200);
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'comment-event-1',
        event: 'comment.received',
      })
    );
    await callbacks.shift()?.();
    expect(inbound.processZernioEvent).toHaveBeenCalledWith(commentPayload);
  });
});
