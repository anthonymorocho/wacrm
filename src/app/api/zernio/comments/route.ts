import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/meta/admin-client';
import {
  getZernioInboxPostComments,
  listZernioCommentedPosts,
  replyToZernioInboxPost,
} from '@/lib/zernio/client';
import {
  listStoredZernioComments,
  persistZernioCommentedPost,
  persistZernioCommentReply,
} from '@/lib/zernio/comments';
import { getZernioConnection } from '@/lib/zernio/connection';
import { getZernioCredentials } from '@/lib/zernio/profile';

interface ZernioContext {
  admin: ReturnType<typeof supabaseAdmin>;
  connection: NonNullable<Awaited<ReturnType<typeof getZernioConnection>>>;
  apiKey: string;
}

async function getConfiguredContext(
  accountId: string
): Promise<ZernioContext | null> {
  const admin = supabaseAdmin();
  const [connection, credentials] = await Promise.all([
    getZernioConnection(admin, accountId),
    getZernioCredentials(admin, accountId),
  ]);
  if (!connection || connection.status !== 'connected' || !credentials) {
    return null;
  }
  return { admin, connection, apiKey: credentials.apiKey };
}

function invalidMessageResponse(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** GET /api/zernio/comments — sync and return mirrored Facebook comments. */
export async function GET() {
  try {
    const { accountId } = await requireRole('viewer');
    const context = await getConfiguredContext(accountId);
    if (!context) {
      return NextResponse.json(
        {
          error: 'Connect a Facebook Page through Zernio first',
          code: 'zernio_not_configured',
        },
        { status: 503 }
      );
    }

    const remotePosts = await listZernioCommentedPosts({
      apiKey: context.apiKey,
      accountId: context.connection.zernio_account_id,
      platform: 'facebook',
      limit: 25,
    });

    for (const remotePost of remotePosts) {
      // The API call is account-scoped, but keep the check here as a second
      // tenant boundary before persisting data returned by a provider.
      if (
        remotePost.platform !== 'facebook' ||
        (remotePost.accountId &&
          remotePost.accountId !== context.connection.zernio_account_id)
      ) {
        continue;
      }
      const comments = await getZernioInboxPostComments({
        apiKey: context.apiKey,
        accountId: context.connection.zernio_account_id,
        postId: remotePost.id,
        limit: 100,
      });
      await persistZernioCommentedPost(context.admin, {
        accountId,
        zernioAccountId: context.connection.zernio_account_id,
        metaChannelId: context.connection.meta_channel_id,
        post: remotePost,
        comments: comments.comments,
      });
    }

    const posts = await listStoredZernioComments(context.admin, {
      accountId,
      zernioAccountId: context.connection.zernio_account_id,
    });
    return NextResponse.json({ posts });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** POST /api/zernio/comments — publish a Facebook post/comment reply. */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent');
    const context = await getConfiguredContext(accountId);
    if (!context) {
      return NextResponse.json(
        {
          error: 'Connect a Facebook Page through Zernio first',
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

    const postId =
      typeof (body as { post_id?: unknown }).post_id === 'string'
        ? (body as { post_id: string }).post_id.trim()
        : '';
    const commentIdValue = (body as { comment_id?: unknown }).comment_id;
    const commentId =
      typeof commentIdValue === 'string' ? commentIdValue.trim() : '';
    const message =
      typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message.trim()
        : '';

    if (!postId) return invalidMessageResponse('post_id is required');
    if (!message) return invalidMessageResponse('message is required');
    if (message.length > 2000) {
      return invalidMessageResponse('message exceeds the 2000-character limit');
    }
    if (commentIdValue !== undefined && !commentId) {
      return invalidMessageResponse('comment_id must be a non-empty string');
    }

    const mirroredPosts = await listStoredZernioComments(context.admin, {
      accountId,
      zernioAccountId: context.connection.zernio_account_id,
    });
    const post = mirroredPosts.find(
      (candidate) => candidate.provider_post_id === postId
    );
    if (!post) {
      return NextResponse.json(
        { error: 'Facebook post is not available in this account' },
        { status: 404 }
      );
    }
    if (
      commentId &&
      !post.comments.some(
        (comment) => comment.provider_comment_id === commentId
      )
    ) {
      return NextResponse.json(
        { error: 'Facebook comment is not available in this post' },
        { status: 404 }
      );
    }

    const reply = await replyToZernioInboxPost({
      apiKey: context.apiKey,
      accountId: context.connection.zernio_account_id,
      postId,
      commentId: commentId || null,
      message,
      idempotencyKey: `wacrm-comment-${accountId}-${userId}-${randomUUID()}`,
    });
    const comment = await persistZernioCommentReply(context.admin, {
      accountId,
      zernioAccountId: context.connection.zernio_account_id,
      providerPostId: postId,
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
