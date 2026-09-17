import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getFacebookPageSelection,
  getZernioConnectUrl,
  getZernioInboxPostComments,
  ensureZernioWebhook,
  listZernioCommentedPosts,
  replyToZernioInboxPost,
  sendZernioInboxMessage,
} from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Zernio client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the hosted Facebook connection flow for a CRM profile', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ authUrl: 'https://zernio.com/oauth' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await getZernioConnectUrl({
      apiKey: 'zrk_test',
      profileId: 'profile-1',
      redirectUrl: 'https://crm.example.com/api/zernio/callback',
    });

    expect(result).toBe('https://zernio.com/oauth');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/api/v1/connect/facebook');
    expect(parsed.searchParams.get('profileId')).toBe('profile-1');
    expect(parsed.searchParams.get('redirect_url')).toBe(
      'https://crm.example.com/api/zernio/callback'
    );
    expect(new Headers(init.headers).get('Authorization')).toBe(
      'Bearer zrk_test'
    );
  });

  it('reads the Page selected inside Zernio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        pages: [{ id: 'page-1', name: 'BUBA' }],
        selectedPageId: 'page-1',
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      getFacebookPageSelection({ apiKey: 'zrk_test', accountId: 'account-1' })
    ).resolves.toEqual({
      pageId: 'page-1',
      pageName: 'BUBA',
    });
  });

  it('does not trust a selected Page id absent from Zernio page data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        pages: [
          { id: 'page-1', name: 'BUBA' },
          { id: 'page-2', name: 'Other' },
        ],
        selectedPageId: 'page-not-returned',
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      getFacebookPageSelection({ apiKey: 'zrk_test', accountId: 'account-1' })
    ).rejects.toThrow('selected Facebook Page');
  });

  it('sends a text message to an existing inbox conversation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          messageId: 'zernio-message-1',
          conversationId: 'zernio-conversation-1',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendZernioInboxMessage({
        apiKey: 'zrk_private',
        accountId: 'zernio-account-1',
        conversationId: 'zernio-conversation-1',
        message: 'Hola desde el CRM',
        idempotencyKey: 'crm-send-1',
      })
    ).resolves.toEqual({
      messageId: 'zernio-message-1',
      conversationId: 'zernio-conversation-1',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://zernio.com/api/v1/inbox/conversations/zernio-conversation-1/messages'
    );
    expect(new Headers(init.headers).get('Authorization')).toBe(
      'Bearer zrk_private'
    );
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('crm-send-1');
    expect(JSON.parse(String(init.body))).toEqual({
      accountId: 'zernio-account-1',
      message: 'Hola desde el CRM',
    });
  });

  it('lists Facebook posts with comments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'zernio-post-1',
            platform: 'facebook',
            accountId: 'zernio-account-1',
            accountUsername: 'acme',
            content: 'Una publicación',
            picture: null,
            permalink: 'https://facebook.com/post-1',
            createdTime: '2026-09-17T12:00:00.000Z',
            commentCount: 2,
            likeCount: 4,
          },
        ],
        pagination: { hasMore: false, nextCursor: null },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      listZernioCommentedPosts({
        apiKey: 'zrk_private',
        accountId: 'zernio-account-1',
        platform: 'facebook',
        limit: 25,
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'zernio-post-1',
        accountId: 'zernio-account-1',
        commentCount: 2,
      }),
    ]);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/v1/inbox/comments');
    expect(new URL(url).searchParams.get('accountId')).toBe('zernio-account-1');
    expect(new URL(url).searchParams.get('platform')).toBe('facebook');
  });

  it('gets comments for one Facebook post and replies to a comment', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'success',
          comments: [
            {
              id: 'comment-1',
              message: '¿Cuál es el precio?',
              createdTime: '2026-09-17T12:00:00.000Z',
              from: { id: 'person-1', name: 'Ana', isOwner: false },
              likeCount: 0,
              replyCount: 0,
              platform: 'facebook',
              url: null,
              replies: [],
              canReply: true,
            },
          ],
          pagination: { hasMore: false },
          meta: { platform: 'facebook', postId: 'zernio-post-1' },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { commentId: 'reply-1', isReply: true, cid: null },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getZernioInboxPostComments({
        apiKey: 'zrk_private',
        accountId: 'zernio-account-1',
        postId: 'zernio-post-1',
        limit: 100,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        comments: [expect.objectContaining({ id: 'comment-1' })],
      })
    );

    await expect(
      replyToZernioInboxPost({
        apiKey: 'zrk_private',
        accountId: 'zernio-account-1',
        postId: 'zernio-post-1',
        commentId: 'comment-1',
        message: 'Te escribimos por privado.',
        idempotencyKey: 'comment-reply-1',
      })
    ).resolves.toEqual({ commentId: 'reply-1', isReply: true });

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://zernio.com/api/v1/inbox/comments/zernio-post-1');
    expect(JSON.parse(String(init.body))).toEqual({
      accountId: 'zernio-account-1',
      message: 'Te escribimos por privado.',
      commentId: 'comment-1',
    });
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe(
      'comment-reply-1'
    );
  });

  it('subscribes the account webhook to incoming comments', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ webhooks: [] }))
      .mockResolvedValueOnce(jsonResponse({ webhook: { _id: 'webhook-1' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      ensureZernioWebhook({
        apiKey: 'zrk_private',
        url: 'https://crm.example.com/api/zernio/webhook',
        secret: 'webhook-secret',
      })
    ).resolves.toBe('webhook-1');

    expect(
      JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    ).toEqual(
      expect.objectContaining({
        events: [
          'message.received',
          'comment.received',
          'account.disconnected',
        ],
      })
    );
  });
});
