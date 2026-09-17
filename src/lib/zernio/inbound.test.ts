import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ from: vi.fn() }));
const comments = vi.hoisted(() => ({
  parseZernioCommentEvent: vi.fn(),
  persistZernioCommentEvent: vi.fn(),
}));

vi.mock('@/lib/meta/admin-client', () => ({
  supabaseAdmin: () => ({ from: database.from }),
}));
vi.mock('./comments', () => comments);

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
});
