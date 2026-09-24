import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ from: vi.fn() }));
const comments = vi.hoisted(() => ({
  parseZernioCommentEvent: vi.fn(),
  persistZernioCommentEvent: vi.fn(),
}));
const metaInbound = vi.hoisted(() => ({
  processNormalizedMetaMessage: vi.fn(),
}));

vi.mock('@/lib/meta/admin-client', () => ({
  supabaseAdmin: () => ({ from: database.from }),
}));
vi.mock('./comments', () => comments);
vi.mock('@/lib/meta/inbound', () => metaInbound);

import { processZernioEvent } from './inbound';

describe('processZernioEvent comment routing', () => {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    builder.maybeSingle.mockResolvedValue({
      data: {
        account_id: 'account-1',
        meta_channel_id: 'channel-1',
        provider: 'messenger',
        status: 'connected',
      },
      error: null,
    });
    database.from.mockReturnValue(builder);
    comments.parseZernioCommentEvent.mockReturnValue({
      accountId: 'zernio-account-1',
      profileId: 'zernio-profile-1',
      providerPostId: 'post-1',
      platformPostId: 'facebook-post-1',
      platform: 'facebook',
      post: {},
      comment: {},
      rawPayload: {},
    });
    comments.persistZernioCommentEvent.mockResolvedValue({});
  });

  it('routes a comment event when Zernio supplies account.id', async () => {
    const result = await processZernioEvent({
      event: 'comment.received',
      account: { id: 'zernio-account-1', profileId: 'zernio-profile-1' },
    });

    expect(result).toBe('inserted');
    expect(comments.persistZernioCommentEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: 'account-1',
        zernioAccountId: 'zernio-account-1',
        metaChannelId: 'channel-1',
      })
    );
  });

  it('ignores a comment whose platform differs from the mapped provider', async () => {
    comments.parseZernioCommentEvent.mockReturnValueOnce({
      accountId: 'zernio-account-1',
      profileId: 'zernio-profile-1',
      providerPostId: 'ig-post-1',
      platformPostId: 'media-1',
      platform: 'instagram',
      post: {},
      comment: {},
      rawPayload: {},
    });

    const result = await processZernioEvent({
      event: 'comment.received',
      account: { id: 'zernio-account-1', profileId: 'zernio-profile-1' },
    });

    expect(result).toBe('ignored');
    expect(comments.persistZernioCommentEvent).not.toHaveBeenCalled();
  });

  it('persists an Instagram comment for the mapped Instagram provider', async () => {
    builder.maybeSingle.mockResolvedValueOnce({
      data: {
        account_id: 'account-1',
        meta_channel_id: 'channel-ig',
        provider: 'instagram',
        status: 'connected',
      },
      error: null,
    });
    comments.parseZernioCommentEvent.mockReturnValueOnce({
      accountId: 'zernio-account-1',
      profileId: 'zernio-profile-1',
      providerPostId: 'ig-post-1',
      platformPostId: 'media-1',
      platform: 'instagram',
      post: {},
      comment: {},
      rawPayload: {},
    });

    const result = await processZernioEvent({
      event: 'comment.received',
      account: { id: 'zernio-account-1', profileId: 'zernio-profile-1' },
    });

    expect(result).toBe('inserted');
    expect(comments.persistZernioCommentEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ metaChannelId: 'channel-ig' })
    );
  });

  it('ignores an Instagram comment when no organic post was mirrored', async () => {
    builder.maybeSingle.mockResolvedValueOnce({
      data: {
        account_id: 'account-1',
        meta_channel_id: 'channel-ig',
        provider: 'instagram',
        status: 'connected',
      },
      error: null,
    });
    comments.parseZernioCommentEvent.mockReturnValueOnce({
      accountId: 'zernio-account-1',
      profileId: 'zernio-profile-1',
      providerPostId: 'internal-post-1',
      platformPostId: 'unmirrored-media',
      platform: 'instagram',
      post: {},
      comment: {},
      rawPayload: {},
    });
    comments.persistZernioCommentEvent.mockResolvedValueOnce(null);

    const result = await processZernioEvent({
      event: 'comment.received',
      account: { id: 'zernio-account-1', profileId: 'zernio-profile-1' },
    });

    expect(result).toBe('ignored');
  });

  it('ignores a comment when the mapped provider is unexpected', async () => {
    builder.maybeSingle.mockResolvedValueOnce({
      data: {
        account_id: 'account-1',
        meta_channel_id: 'channel-unknown',
        provider: 'unknown',
        status: 'connected',
      },
      error: null,
    });

    const result = await processZernioEvent({
      event: 'comment.received',
      account: { id: 'zernio-account-1', profileId: 'zernio-profile-1' },
    });

    expect(result).toBe('ignored');
    expect(comments.persistZernioCommentEvent).not.toHaveBeenCalled();
  });
});

describe('processZernioEvent message routing', () => {
  const connection = {
    account_id: 'account-1',
    meta_channel_id: 'channel-1',
    provider: 'instagram',
    status: 'connected',
  };
  const channel = {
    id: 'channel-1',
    account_id: 'account-1',
    provider: 'instagram',
    integration_source: 'zernio',
    status: 'connected',
  };
  const payload = {
    event: 'message.received',
    account: { accountId: 'zernio-account-1', profileId: 'profile-1' },
    message: {
      platform: 'instagram',
      direction: 'incoming',
      platformMessageId: 'mid-1',
      text: 'Hello',
      sender: { id: 'customer-1' },
      sentAt: '2026-09-17T12:00:00Z',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    database.from.mockImplementation((table: string) => {
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: table === 'zernio_connections' ? connection : channel,
          error: null,
        }),
      };
      return builder;
    });
    metaInbound.processNormalizedMetaMessage.mockResolvedValue('inserted');
  });

  it('delivers an Instagram message only to its Instagram channel', async () => {
    expect(await processZernioEvent(payload)).toBe('inserted');
    expect(metaInbound.processNormalizedMetaMessage).toHaveBeenCalledWith(
      expect.anything(),
      channel,
      expect.objectContaining({ provider: 'instagram' })
    );
  });

  it('ignores a message when its platform differs from the connection', async () => {
    expect(
      await processZernioEvent({
        ...payload,
        message: { ...payload.message, platform: 'facebook' },
      })
    ).toBe('ignored');
    expect(metaInbound.processNormalizedMetaMessage).not.toHaveBeenCalled();
  });

  it('ignores a message when its mapped channel differs from the event', async () => {
    database.from.mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data:
          table === 'zernio_connections'
            ? connection
            : { ...channel, provider: 'messenger' },
        error: null,
      }),
    }));
    expect(await processZernioEvent(payload)).toBe('ignored');
    expect(metaInbound.processNormalizedMetaMessage).not.toHaveBeenCalled();
  });
});
