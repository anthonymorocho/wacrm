import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  flattenZernioComments,
  parseZernioCommentEvent,
  persistZernioCommentedPost,
  persistZernioCommentEvent,
} from './comments';

describe('Zernio comments', () => {
  it('normalizes an Instagram comment with its post and comment platform', () => {
    const parsed = parseZernioCommentEvent({
      event: 'comment.received',
      account: {
        accountId: 'ig-account-1',
        profileId: 'profile-1',
        platform: 'instagram',
      },
      post: { id: 'ig-post-1', platformPostId: 'media-1', content: 'Photo' },
      comment: {
        id: 'ig-comment-1',
        postId: 'ig-post-1',
        platformPostId: 'media-1',
        platform: 'instagram',
        text: 'Nice photo',
        author: { id: 'person-1', username: 'viewer' },
        createdAt: '2026-09-17T12:00:00.000Z',
      },
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        accountId: 'ig-account-1',
        platform: 'instagram',
        post: expect.objectContaining({
          platform: 'instagram',
          platformPostId: 'media-1',
        }),
        comment: expect.objectContaining({
          platform: 'instagram',
          id: 'ig-comment-1',
        }),
      })
    );
  });

  it('stores an Instagram webhook comment on the matching organic mirror', async () => {
    const event = parseZernioCommentEvent({
      event: 'comment.received',
      account: {
        accountId: 'ig-account-1',
        profileId: 'profile-1',
        platform: 'instagram',
      },
      post: { id: 'internal-post-1', platformPostId: 'media-1' },
      comment: {
        id: 'ig-comment-1',
        platformPostId: 'media-1',
        platform: 'instagram',
        text: 'Nice photo',
        author: { id: 'person-1' },
        createdAt: '2026-09-17T12:00:00.000Z',
      },
    });
    expect(event).not.toBeNull();
    const rows: Array<{ table: string; value: Record<string, unknown> }> = [];
    const filters: Array<[string, unknown]> = [];
    const mirror = {
      select: () => mirror,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return mirror;
      },
      maybeSingle: async () => ({
        data: {
          id: 'local-post-1',
          provider_post_id: 'organic-list-post-1',
          platform_post_id: 'media-1',
          platform: 'instagram',
        },
        error: null,
      }),
      upsert: (value: Record<string, unknown>) => {
        rows.push({ table: 'social_posts', value });
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: 'created-post',
                platform_post_id: 'media-1',
                platform: 'instagram',
              },
              error: null,
            }),
          }),
        };
      },
    };
    const db = {
      from: (table: string) =>
        table === 'social_posts'
          ? mirror
          : {
              upsert: (value: Record<string, unknown>) => {
                rows.push({ table, value });
                return {
                  select: () => ({
                    single: async () => ({
                      data: { id: 'local-comment-1', platform: 'instagram' },
                      error: null,
                    }),
                  }),
                };
              },
            },
    } as unknown as SupabaseClient;

    await persistZernioCommentEvent(db, {
      accountId: 'account-1',
      zernioAccountId: 'ig-account-1',
      metaChannelId: 'channel-ig',
      event: event!,
    });

    expect(filters).toEqual([
      ['account_id', 'account-1'],
      ['zernio_account_id', 'ig-account-1'],
      ['meta_channel_id', 'channel-ig'],
      ['platform', 'instagram'],
      ['platform_post_id', 'media-1'],
    ]);
    expect(rows).toEqual([
      {
        table: 'social_comments',
        value: expect.objectContaining({
          account_id: 'account-1',
          social_post_id: 'local-post-1',
          platform: 'instagram',
          provider_comment_id: 'ig-comment-1',
        }),
      },
    ]);
  });

  it('ignores an unmirrored Instagram webhook comment without writing rows', async () => {
    const event = parseZernioCommentEvent({
      event: 'comment.received',
      account: {
        accountId: 'ig-account-1',
        profileId: 'profile-1',
        platform: 'instagram',
      },
      post: { id: null, platformPostId: 'unmirrored-media' },
      comment: {
        id: 'ig-comment-2',
        postId: null,
        platformPostId: 'unmirrored-media',
        platform: 'instagram',
        text: 'Hello',
        author: { id: 'person-2' },
        createdAt: '2026-09-17T12:00:00.000Z',
      },
    });
    expect(event).not.toBeNull();
    const writes: string[] = [];
    const mirror = {
      select: () => mirror,
      eq: () => mirror,
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: () => {
        writes.push('social_posts');
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: 'created-post',
                platform_post_id: 'unmirrored-media',
              },
              error: null,
            }),
          }),
        };
      },
    };
    const db = {
      from: (table: string) =>
        table === 'social_posts'
          ? mirror
          : {
              upsert: () => {
                writes.push(table);
                return {
                  select: () => ({
                    single: async () => ({ data: {}, error: null }),
                  }),
                };
              },
            },
    } as unknown as SupabaseClient;

    const result = await persistZernioCommentEvent(db, {
      accountId: 'account-1',
      zernioAccountId: 'ig-account-1',
      metaChannelId: 'channel-ig',
      event: event!,
    });

    expect(result).toBeNull();
    expect(writes).toEqual([]);
  });

  it('continues mirroring Facebook posts from comment webhooks', async () => {
    const event = parseZernioCommentEvent({
      event: 'comment.received',
      account: {
        accountId: 'fb-account-1',
        profileId: 'profile-1',
        platform: 'facebook',
      },
      post: { id: null, platformPostId: 'fb-post-1' },
      comment: {
        id: 'fb-comment-1',
        postId: null,
        platformPostId: 'fb-post-1',
        platform: 'facebook',
        text: 'Hello',
        author: { id: 'person-1' },
        createdAt: '2026-09-17T12:00:00.000Z',
      },
    });
    expect(event).not.toBeNull();
    const rows: Array<{ table: string; value: Record<string, unknown> }> = [];
    const db = {
      from: (table: string) => ({
        upsert: (value: Record<string, unknown>) => {
          rows.push({ table, value });
          return {
            select: () => ({
              single: async () => ({
                data:
                  table === 'social_posts'
                    ? {
                        id: 'local-fb-post',
                        platform_post_id: 'fb-post-1',
                        platform: 'facebook',
                      }
                    : { id: 'local-fb-comment', platform: 'facebook' },
                error: null,
              }),
            }),
          };
        },
      }),
    } as unknown as SupabaseClient;

    await persistZernioCommentEvent(db, {
      accountId: 'account-1',
      zernioAccountId: 'fb-account-1',
      metaChannelId: 'channel-fb',
      event: event!,
    });

    expect(rows).toEqual([
      {
        table: 'social_posts',
        value: expect.objectContaining({
          provider_post_id: 'fb-post-1',
          platform: 'facebook',
        }),
      },
      {
        table: 'social_comments',
        value: expect.objectContaining({
          social_post_id: 'local-fb-post',
          platform: 'facebook',
        }),
      },
    ]);
  });

  it('inherits the post platform for a synced comment with no platform field', async () => {
    const rows: Array<{ table: string; value: Record<string, unknown> }> = [];
    const db = {
      from: (table: string) => ({
        upsert: (value: Record<string, unknown>) => {
          rows.push({ table, value });
          return {
            select: () => ({
              single: async () => ({
                data:
                  table === 'social_posts'
                    ? {
                        id: 'local-post-1',
                        platform_post_id: 'media-1',
                        platform: 'instagram',
                      }
                    : { id: 'local-comment-1', platform: 'instagram' },
                error: null,
              }),
            }),
          };
        },
      }),
    } as unknown as SupabaseClient;

    await persistZernioCommentedPost(db, {
      accountId: 'account-1',
      zernioAccountId: 'ig-account-1',
      metaChannelId: 'channel-ig',
      post: {
        id: 'ig-post-1',
        platformPostId: 'media-1',
        platform: 'instagram',
        accountId: 'ig-account-1',
        accountUsername: null,
        content: 'Photo',
        picture: null,
        permalink: null,
        createdTime: '2026-09-17T12:00:00.000Z',
        commentCount: 1,
        likeCount: 0,
      },
      comments: [
        {
          id: 'ig-comment-1',
          message: 'Nice photo',
          createdTime: '2026-09-17T12:00:00.000Z',
          from: {
            id: 'person-1',
            name: null,
            username: null,
            picture: null,
            isOwner: false,
          },
          likeCount: 0,
          replyCount: 0,
          url: null,
          replies: [],
          canReply: true,
        },
        {
          id: 'wrong-platform-comment',
          message: 'Wrong platform',
          createdTime: '2026-09-17T12:00:00.000Z',
          from: {
            id: 'person-2',
            name: null,
            username: null,
            picture: null,
            isOwner: false,
          },
          likeCount: 0,
          replyCount: 0,
          platform: 'facebook',
          url: null,
          replies: [],
          canReply: true,
        },
      ],
    });

    expect(
      rows.map(({ table, value }) => ({ table, platform: value.platform }))
    ).toEqual([
      { table: 'social_posts', platform: 'instagram' },
      { table: 'social_comments', platform: 'instagram' },
    ]);
  });

  it('rejects unsupported and account-mismatched comment platforms', () => {
    const base = {
      event: 'comment.received',
      account: {
        accountId: 'account-1',
        profileId: 'profile-1',
        platform: 'instagram',
      },
      post: { id: 'post-1', platformPostId: 'media-1' },
      comment: {
        id: 'comment-1',
        platformPostId: 'media-1',
        text: 'Hi',
        author: { id: 'person-1' },
        createdAt: '2026-09-17T12:00:00.000Z',
      },
    };
    for (const platform of ['facebook', 'tiktok']) {
      expect(
        parseZernioCommentEvent({
          ...base,
          comment: { ...base.comment, platform },
        })
      ).toBeNull();
    }
  });

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
