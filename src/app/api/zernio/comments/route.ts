import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/meta/admin-client';
import {
  getZernioInboxPostComments,
  listZernioCommentedPosts,
  replyToZernioInboxPost,
} from '@/lib/zernio/client';
import type { ZernioSocialPlatform } from '@/lib/zernio/client';
import {
  listStoredZernioComments,
  persistZernioCommentedPost,
  persistZernioCommentReply,
} from '@/lib/zernio/comments';
import { getZernioConnections } from '@/lib/zernio/connection';
import { getZernioCredentials } from '@/lib/zernio/profile';

interface ZernioContext {
  admin: ReturnType<typeof supabaseAdmin>;
  connections: Awaited<ReturnType<typeof getZernioConnections>>;
  apiKey: string;
}

async function getConfiguredContext(
  accountId: string
): Promise<ZernioContext | null> {
  const admin = supabaseAdmin();
  const [connections, credentials] = await Promise.all([
    getZernioConnections(admin, accountId),
    getZernioCredentials(admin, accountId),
  ]);
  const activeConnections = connections.filter(
    (connection) =>
      connection.account_id === accountId && connection.status === 'connected'
  );
  if (!activeConnections.length || !credentials) {
    return null;
  }
  return { admin, connections: activeConnections, apiKey: credentials.apiKey };
}

function platformForProvider(
  provider: 'messenger' | 'instagram'
): ZernioSocialPlatform {
  return provider === 'instagram' ? 'instagram' : 'facebook';
}

function invalidMessageResponse(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** GET /api/zernio/comments — sync public comments for active channels. */
export async function GET(request?: Request) {
  try {
    const { accountId } = await requireRole('viewer');
    const requestedPlatform = request
      ? new URL(request.url).searchParams.get('platform')
      : null;
    if (
      requestedPlatform &&
      requestedPlatform !== 'facebook' &&
      requestedPlatform !== 'instagram'
    ) {
      return invalidMessageResponse('platform must be facebook or instagram');
    }
    const context = await getConfiguredContext(accountId);
    if (!context) {
      return NextResponse.json(
        {
          error: 'Connect a Facebook or Instagram account through Zernio first',
          code: 'zernio_not_configured',
        },
        { status: 503 }
      );
    }

    const posts = [];
    for (const connection of context.connections) {
      const platform = platformForProvider(connection.provider);
      if (requestedPlatform && requestedPlatform !== platform) continue;
      const remotePosts = await listZernioCommentedPosts({
        apiKey: context.apiKey,
        accountId: connection.zernio_account_id,
        platform,
        limit: 25,
      });
      for (const remotePost of remotePosts) {
        if (
          remotePost.platform !== platform ||
          remotePost.accountId !== connection.zernio_account_id
        )
          continue;
        const comments = await getZernioInboxPostComments({
          apiKey: context.apiKey,
          accountId: connection.zernio_account_id,
          postId: remotePost.id,
          limit: 100,
        });
        await persistZernioCommentedPost(context.admin, {
          accountId,
          zernioAccountId: connection.zernio_account_id,
          metaChannelId: connection.meta_channel_id,
          post: remotePost,
          comments: comments.comments.filter(
            (comment) => !comment.platform || comment.platform === platform
          ),
        });
      }
      const stored = await listStoredZernioComments(context.admin, {
        accountId,
        zernioAccountId: connection.zernio_account_id,
      });
      posts.push(
        ...stored.filter(
          (post) =>
            post.account_id === accountId &&
            post.zernio_account_id === connection.zernio_account_id &&
            post.meta_channel_id === connection.meta_channel_id &&
            post.platform === platform
        )
      );
    }
    posts.sort((left, right) =>
      (right.created_time ?? '').localeCompare(left.created_time ?? '')
    );
    return NextResponse.json({ posts });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** POST /api/zernio/comments — publish a public organic post/comment reply. */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent');
    const context = await getConfiguredContext(accountId);
    if (!context) {
      return NextResponse.json(
        {
          error: 'Connect a Facebook or Instagram account through Zernio first',
          code: 'zernio_not_configured',
        },
        { status: 503 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return invalidMessageResponse('Invalid JSON');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return invalidMessageResponse('Request body must be an object');
    }

    const socialPostId =
      typeof (body as { social_post_id?: unknown }).social_post_id === 'string'
        ? (body as { social_post_id: string }).social_post_id.trim()
        : '';
    const commentIdValue = (body as { comment_id?: unknown }).comment_id;
    const commentId =
      typeof commentIdValue === 'string' ? commentIdValue.trim() : '';
    const message =
      typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message.trim()
        : '';

    if (!socialPostId)
      return invalidMessageResponse('social_post_id is required');
    if (!message) return invalidMessageResponse('message is required');
    if (message.length > 2000) {
      return invalidMessageResponse('message exceeds the 2000-character limit');
    }
    if (commentIdValue !== undefined && !commentId) {
      return invalidMessageResponse('comment_id must be a non-empty string');
    }

    let target: {
      connection: (typeof context.connections)[number];
      post: Awaited<ReturnType<typeof listStoredZernioComments>>[number];
    } | null = null;
    for (const connection of context.connections) {
      const mirroredPosts = await listStoredZernioComments(context.admin, {
        accountId,
        zernioAccountId: connection.zernio_account_id,
      });
      const post = mirroredPosts.find(
        (candidate) =>
          candidate.account_id === accountId &&
          candidate.zernio_account_id === connection.zernio_account_id &&
          candidate.meta_channel_id === connection.meta_channel_id &&
          candidate.platform === platformForProvider(connection.provider) &&
          candidate.id === socialPostId
      );
      if (post) {
        target = { connection, post };
        break;
      }
    }
    if (!target) {
      return NextResponse.json(
        { error: 'Post is not available in this account' },
        { status: 404 }
      );
    }
    if (
      commentId &&
      !target.post.comments.some(
        (comment) =>
          comment.provider_comment_id === commentId &&
          comment.social_post_id === target.post.id &&
          comment.zernio_account_id === target.connection.zernio_account_id &&
          comment.platform === target.post.platform
      )
    ) {
      return NextResponse.json(
        { error: 'Comment is not available in this post' },
        { status: 404 }
      );
    }

    const reply = await replyToZernioInboxPost({
      apiKey: context.apiKey,
      accountId: target.connection.zernio_account_id,
      postId: target.post.provider_post_id,
      commentId: commentId || null,
      message,
      idempotencyKey: `wacrm-comment-${accountId}-${userId}-${randomUUID()}`,
    });
    const comment = await persistZernioCommentReply(context.admin, {
      accountId,
      zernioAccountId: target.connection.zernio_account_id,
      providerPostId: target.post.provider_post_id,
      providerCommentId: reply.commentId,
      parentCommentId: commentId || null,
      message,
      isReply: reply.isReply,
    });

    return NextResponse.json({ comment });
  } catch (error) {
    return toErrorResponse(error);
  }
}
