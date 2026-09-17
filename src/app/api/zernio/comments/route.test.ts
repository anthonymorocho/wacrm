import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
  getZernioConnection: vi.fn(),
  getZernioCredentials: vi.fn(),
  listZernioCommentedPosts: vi.fn(),
  getZernioInboxPostComments: vi.fn(),
  replyToZernioInboxPost: vi.fn(),
  persistZernioCommentedPost: vi.fn(),
  persistZernioCommentReply: vi.fn(),
  listStoredZernioComments: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((error: { message?: string; status?: number }) =>
    NextResponse.json(
      { error: error.message ?? 'Internal server error' },
      { status: error.status ?? 500 }
    )
  ),
}));
vi.mock('@/lib/meta/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));
vi.mock('@/lib/zernio/connection', () => ({
  getZernioConnection: mocks.getZernioConnection,
}));
vi.mock('@/lib/zernio/profile', () => ({
  getZernioCredentials: mocks.getZernioCredentials,
}));
vi.mock('@/lib/zernio/client', () => ({
  listZernioCommentedPosts: mocks.listZernioCommentedPosts,
  getZernioInboxPostComments: mocks.getZernioInboxPostComments,
  replyToZernioInboxPost: mocks.replyToZernioInboxPost,
}));
vi.mock('@/lib/zernio/comments', () => ({
  persistZernioCommentedPost: mocks.persistZernioCommentedPost,
  persistZernioCommentReply: mocks.persistZernioCommentReply,
  listStoredZernioComments: mocks.listStoredZernioComments,
}));

import { GET, POST } from './route';

const connection = {
  meta_channel_id: 'channel-1',
  zernio_account_id: 'zernio-account-1',
  status: 'connected',
};
const credentials = { apiKey: 'private-key', webhookSecret: 'private-secret' };
const storedPost = {
  id: 'local-post-1',
  provider_post_id: 'zernio-post-1',
  platform_post_id: 'facebook-post-1',
  comments: [
    {
      id: 'local-comment-1',
      provider_comment_id: 'comment-1',
      social_post_id: 'local-post-1',
    },
  ],
};

describe('/api/zernio/comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supabaseAdmin.mockReturnValue({});
    mocks.requireRole.mockResolvedValue({
      userId: 'user-1',
      accountId: 'account-1',
      role: 'agent',
    });
    mocks.getZernioConnection.mockResolvedValue(connection);
    mocks.getZernioCredentials.mockResolvedValue(credentials);
    mocks.listZernioCommentedPosts.mockResolvedValue([
      {
        id: 'zernio-post-1',
        platform: 'facebook',
        accountId: 'zernio-account-1',
        accountUsername: 'acme',
        content: 'Publicación',
        picture: null,
        permalink: null,
        createdTime: '2026-09-17T12:00:00.000Z',
        commentCount: 1,
        likeCount: 0,
      },
    ]);
    mocks.getZernioInboxPostComments.mockResolvedValue({
      comments: [],
      hasMore: false,
      cursor: null,
    });
    mocks.persistZernioCommentedPost.mockResolvedValue(storedPost);
    mocks.listStoredZernioComments.mockResolvedValue([storedPost]);
    mocks.replyToZernioInboxPost.mockResolvedValue({
      commentId: 'reply-1',
      isReply: true,
    });
    mocks.persistZernioCommentReply.mockResolvedValue({
      id: 'local-reply-1',
      provider_comment_id: 'reply-1',
    });
  });

  it('syncs Facebook posts and comments using the connected Zernio account', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ posts: [storedPost] });
    expect(mocks.listZernioCommentedPosts).toHaveBeenCalledWith({
      apiKey: 'private-key',
      accountId: 'zernio-account-1',
      platform: 'facebook',
      limit: 25,
    });
    expect(mocks.persistZernioCommentedPost).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        accountId: 'account-1',
        zernioAccountId: 'zernio-account-1',
        metaChannelId: 'channel-1',
      })
    );
  });

  it('replies only to a stored comment from the connected account', async () => {
    const response = await POST(
      new Request('http://localhost/api/zernio/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          post_id: 'zernio-post-1',
          comment_id: 'comment-1',
          message: 'Gracias por escribirnos',
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      comment: { id: 'local-reply-1', provider_comment_id: 'reply-1' },
    });
    expect(mocks.replyToZernioInboxPost).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'private-key',
        accountId: 'zernio-account-1',
        postId: 'zernio-post-1',
        commentId: 'comment-1',
        message: 'Gracias por escribirnos',
      })
    );
    expect(mocks.persistZernioCommentReply).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        accountId: 'account-1',
        providerPostId: 'zernio-post-1',
        providerCommentId: 'reply-1',
        parentCommentId: 'comment-1',
      })
    );
  });

  it('rejects a reply target not present in the account mirror', async () => {
    mocks.listStoredZernioComments.mockResolvedValue([
      { ...storedPost, provider_post_id: 'another-post' },
    ]);

    const response = await POST(
      new Request('http://localhost/api/zernio/comments', {
        method: 'POST',
        body: JSON.stringify({
          post_id: 'zernio-post-1',
          message: 'No debería enviarse',
        }),
      })
    );

    expect(response.status).toBe(404);
    expect(mocks.replyToZernioInboxPost).not.toHaveBeenCalled();
  });
});
