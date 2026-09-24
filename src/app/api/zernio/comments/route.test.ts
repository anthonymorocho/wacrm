import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
  getZernioConnections: vi.fn(),
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
  getZernioConnections: mocks.getZernioConnections,
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
  account_id: 'account-1',
  meta_channel_id: 'channel-1',
  zernio_account_id: 'zernio-account-1',
  provider: 'messenger',
  status: 'connected',
};
const instagramConnection = {
  account_id: 'account-1',
  meta_channel_id: 'channel-ig',
  zernio_account_id: 'ig-account-1',
  provider: 'instagram',
  status: 'connected',
};
const credentials = { apiKey: 'private-key', webhookSecret: 'private-secret' };
const storedPost = {
  id: 'local-post-1',
  account_id: 'account-1',
  meta_channel_id: 'channel-1',
  zernio_account_id: 'zernio-account-1',
  platform: 'facebook',
  provider_post_id: 'zernio-post-1',
  platform_post_id: 'facebook-post-1',
  comments: [
    {
      id: 'local-comment-1',
      provider_comment_id: 'comment-1',
      social_post_id: 'local-post-1',
      zernio_account_id: 'zernio-account-1',
      platform: 'facebook',
    },
  ],
};
const instagramPost = {
  ...storedPost,
  id: 'local-ig-post',
  meta_channel_id: 'channel-ig',
  zernio_account_id: 'ig-account-1',
  platform: 'instagram',
  provider_post_id: 'ig-post-1',
  platform_post_id: 'media-1',
  comments: [
    {
      id: 'local-ig-comment',
      provider_comment_id: 'ig-comment-1',
      social_post_id: 'local-ig-post',
      zernio_account_id: 'ig-account-1',
      platform: 'instagram',
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
    mocks.getZernioConnections.mockResolvedValue([connection]);
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

  it('syncs both active channels and returns their account-owned mirrors', async () => {
    mocks.getZernioConnections.mockResolvedValue([
      connection,
      instagramConnection,
    ]);
    mocks.listZernioCommentedPosts.mockImplementation(
      async ({ accountId }: { accountId: string }) =>
        accountId === 'ig-account-1'
          ? [
              {
                id: 'ig-post-1',
                platform: 'instagram',
                accountId: 'ig-account-1',
              },
            ]
          : [
              {
                id: 'zernio-post-1',
                platform: 'facebook',
                accountId: 'zernio-account-1',
              },
            ]
    );
    mocks.listStoredZernioComments.mockImplementation(
      async (
        _admin: unknown,
        { zernioAccountId }: { zernioAccountId: string }
      ) => (zernioAccountId === 'ig-account-1' ? [instagramPost] : [storedPost])
    );

    const response = await GET(
      new Request('http://localhost/api/zernio/comments')
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      posts: [storedPost, instagramPost],
    });
    expect(mocks.listZernioCommentedPosts).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'ig-account-1',
        platform: 'instagram',
      })
    );
    expect(mocks.persistZernioCommentedPost).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        zernioAccountId: 'ig-account-1',
        metaChannelId: 'channel-ig',
        post: expect.objectContaining({ platform: 'instagram' }),
      })
    );
  });

  it('filters listing to the requested Instagram platform', async () => {
    mocks.getZernioConnections.mockResolvedValue([
      connection,
      instagramConnection,
    ]);
    mocks.listZernioCommentedPosts.mockResolvedValue([]);
    mocks.listStoredZernioComments.mockResolvedValue([instagramPost]);

    const response = await GET(
      new Request('http://localhost/api/zernio/comments?platform=instagram')
    );

    expect(response.status).toBe(200);
    expect(mocks.listZernioCommentedPosts).toHaveBeenCalledTimes(1);
    expect(mocks.listZernioCommentedPosts).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'ig-account-1',
        platform: 'instagram',
      })
    );
    expect(mocks.listStoredZernioComments).toHaveBeenCalledWith(
      {},
      {
        accountId: 'account-1',
        zernioAccountId: 'ig-account-1',
      }
    );
  });

  it('does not persist a post returned for another account or platform', async () => {
    mocks.getZernioConnections.mockResolvedValue([
      connection,
      instagramConnection,
    ]);
    mocks.listZernioCommentedPosts.mockResolvedValue([
      {
        id: 'wrong-account',
        platform: 'instagram',
        accountId: 'other-account',
      },
      { id: 'wrong-platform', platform: 'facebook', accountId: 'ig-account-1' },
    ]);
    mocks.listStoredZernioComments.mockResolvedValue([]);

    const response = await GET(
      new Request('http://localhost/api/zernio/comments?platform=instagram')
    );

    expect(response.status).toBe(200);
    expect(mocks.getZernioInboxPostComments).not.toHaveBeenCalled();
    expect(mocks.persistZernioCommentedPost).not.toHaveBeenCalled();
  });

  it('keeps a comment without its own platform under the validated post', async () => {
    const comment = { id: 'comment-without-platform', message: 'Hello' };
    mocks.getZernioInboxPostComments.mockResolvedValue({
      comments: [comment],
      hasMore: false,
      cursor: null,
    });

    const response = await GET(
      new Request('http://localhost/api/zernio/comments')
    );

    expect(response.status).toBe(200);
    expect(mocks.persistZernioCommentedPost).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ comments: [comment] })
    );
  });

  it('replies only to a stored comment from the connected account', async () => {
    const response = await POST(
      new Request('http://localhost/api/zernio/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          social_post_id: 'local-post-1',
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
      { ...storedPost, id: 'another-post' },
    ]);

    const response = await POST(
      new Request('http://localhost/api/zernio/comments', {
        method: 'POST',
        body: JSON.stringify({
          social_post_id: 'local-post-1',
          message: 'No debería enviarse',
        }),
      })
    );

    expect(response.status).toBe(404);
    expect(mocks.replyToZernioInboxPost).not.toHaveBeenCalled();
  });

  it('replies through the Instagram connection owned by the mirrored post', async () => {
    mocks.getZernioConnections.mockResolvedValue([
      connection,
      instagramConnection,
    ]);
    mocks.listStoredZernioComments.mockImplementation(
      async (
        _admin: unknown,
        { zernioAccountId }: { zernioAccountId: string }
      ) => (zernioAccountId === 'ig-account-1' ? [instagramPost] : [storedPost])
    );

    const response = await POST(
      new Request('http://localhost/api/zernio/comments', {
        method: 'POST',
        body: JSON.stringify({
          social_post_id: 'local-ig-post',
          comment_id: 'ig-comment-1',
          message: 'Thanks',
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.replyToZernioInboxPost).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'ig-account-1',
        postId: 'ig-post-1',
        commentId: 'ig-comment-1',
      })
    );
    expect(mocks.persistZernioCommentReply).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        accountId: 'account-1',
        zernioAccountId: 'ig-account-1',
      })
    );
  });

  it('rejects a comment from another mirrored post before sending', async () => {
    mocks.getZernioConnections.mockResolvedValue([
      connection,
      instagramConnection,
    ]);
    mocks.listStoredZernioComments.mockImplementation(
      async (
        _admin: unknown,
        { zernioAccountId }: { zernioAccountId: string }
      ) => (zernioAccountId === 'ig-account-1' ? [instagramPost] : [storedPost])
    );

    const response = await POST(
      new Request('http://localhost/api/zernio/comments', {
        method: 'POST',
        body: JSON.stringify({
          social_post_id: 'local-ig-post',
          comment_id: 'comment-1',
          message: 'Wrong target',
        }),
      })
    );

    expect(response.status).toBe(404);
    expect(mocks.replyToZernioInboxPost).not.toHaveBeenCalled();
  });

  it('rejects a mirrored post owned by another tenant before sending', async () => {
    mocks.getZernioConnections.mockResolvedValue([
      connection,
      instagramConnection,
    ]);
    mocks.listStoredZernioComments.mockResolvedValue([
      { ...instagramPost, account_id: 'other-account' },
    ]);

    const response = await POST(
      new Request('http://localhost/api/zernio/comments', {
        method: 'POST',
        body: JSON.stringify({
          social_post_id: 'local-ig-post',
          message: 'Wrong tenant',
        }),
      })
    );

    expect(response.status).toBe(404);
    expect(mocks.replyToZernioInboxPost).not.toHaveBeenCalled();
  });

  it('uses the local Instagram post when both providers share a remote post id', async () => {
    mocks.getZernioConnections.mockResolvedValue([
      connection,
      instagramConnection,
    ]);
    mocks.listStoredZernioComments.mockImplementation(
      async (
        _admin: unknown,
        { zernioAccountId }: { zernioAccountId: string }
      ) =>
        zernioAccountId === 'ig-account-1'
          ? [{ ...instagramPost, provider_post_id: 'shared-post-1' }]
          : [{ ...storedPost, provider_post_id: 'shared-post-1' }]
    );

    const response = await POST(
      new Request('http://localhost/api/zernio/comments', {
        method: 'POST',
        body: JSON.stringify({
          social_post_id: 'local-ig-post',
          post_id: 'shared-post-1',
          comment_id: 'ig-comment-1',
          message: 'Thanks',
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.replyToZernioInboxPost).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'ig-account-1',
        postId: 'shared-post-1',
        commentId: 'ig-comment-1',
      })
    );
    expect(mocks.persistZernioCommentReply).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        zernioAccountId: 'ig-account-1',
        providerPostId: 'shared-post-1',
      })
    );
  });
});
