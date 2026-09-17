import { describe, expect, it } from 'vitest';

import { flattenZernioComments, parseZernioCommentEvent } from './comments';

describe('Zernio comments', () => {
  it('normalizes a Facebook comment webhook with its post identity', () => {
    expect(
      parseZernioCommentEvent({
        id: 'event-comment-1',
        event: 'comment.received',
        comment: {
          id: 'comment-1',
          postId: null,
          platformPostId: 'facebook-post-1',
          platform: 'facebook',
          text: 'Hola desde Facebook',
          author: {
            id: 'person-1',
            name: 'Ana',
            username: 'ana',
            picture: null,
            isOwnAccount: false,
          },
          createdAt: '2026-09-17T12:00:00.000Z',
          isReply: false,
          parentCommentId: null,
        },
        post: {
          id: null,
          platformPostId: 'facebook-post-1',
          content: 'Publicación',
          imageUrl: null,
          permalink: 'https://facebook.com/post-1',
        },
        account: {
          id: 'zernio-account-1',
          accountId: 'zernio-account-1',
          profileId: 'zernio-profile-1',
          platform: 'facebook',
          username: 'acme',
        },
        timestamp: '2026-09-17T12:00:01.000Z',
      })
    ).toEqual(
      expect.objectContaining({
        accountId: 'zernio-account-1',
        profileId: 'zernio-profile-1',
        providerPostId: 'facebook-post-1',
        platformPostId: 'facebook-post-1',
        comment: expect.objectContaining({
          id: 'comment-1',
          authorId: 'person-1',
          text: 'Hola desde Facebook',
        }),
      })
    );
  });

  it('flattens nested replies while preserving their parent comment id', () => {
    const flattened = flattenZernioComments([
      {
        id: 'comment-1',
        message: 'Pregunta',
        createdTime: '2026-09-17T12:00:00.000Z',
        from: {
          id: 'person-1',
          name: 'Ana',
          username: null,
          picture: null,
          isOwner: false,
        },
        likeCount: 1,
        replyCount: 1,
        platform: 'facebook',
        url: null,
        replies: [
          {
            id: 'reply-1',
            message: 'Respuesta',
            createdTime: '2026-09-17T12:01:00.000Z',
            from: {
              id: 'page-1',
              name: 'Acme',
              username: null,
              picture: null,
              isOwner: true,
            },
            likeCount: 0,
            replyCount: 0,
            platform: 'facebook',
            url: null,
            replies: [],
            canReply: true,
          },
        ],
        canReply: true,
      },
    ]);

    expect(
      flattened.map(({ id, parentCommentId, isReply }) => ({
        id,
        parentCommentId,
        isReply,
      }))
    ).toEqual([
      { id: 'comment-1', parentCommentId: null, isReply: false },
      { id: 'reply-1', parentCommentId: 'comment-1', isReply: true },
    ]);
  });
});
