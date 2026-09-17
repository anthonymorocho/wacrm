import type { SupabaseClient } from '@supabase/supabase-js';

import type { ZernioCommentedPost, ZernioInboxComment } from './client';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizedTime(value: unknown): string | null {
  const stringValue = nonEmptyString(value);
  if (!stringValue) return null;
  const date = new Date(stringValue);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export interface ParsedZernioCommentEvent {
  accountId: string;
  profileId: string;
  providerPostId: string;
  platformPostId: string;
  post: {
    zernioPostId: string;
    platformPostId: string;
    content: string | null;
    picture: string | null;
    permalink: string | null;
    createdTime: string;
  };
  comment: {
    id: string;
    text: string;
    authorId: string;
    authorName: string | null;
    authorUsername: string | null;
    authorPicture: string | null;
    isOwnAccount: boolean | null;
    createdTime: string;
    isReply: boolean;
    parentCommentId: string | null;
    url: string | null;
  };
  rawPayload: JsonRecord;
}

/** Validate and normalize the Facebook shape sent by comment.received. */
export function parseZernioCommentEvent(
  payload: unknown
): ParsedZernioCommentEvent | null {
  if (!isRecord(payload) || payload.event !== 'comment.received') return null;

  const account = isRecord(payload.account) ? payload.account : null;
  const comment = isRecord(payload.comment) ? payload.comment : null;
  const post = isRecord(payload.post) ? payload.post : null;
  const author = isRecord(comment?.author) ? comment.author : null;
  if (
    !account ||
    !comment ||
    !post ||
    !author ||
    comment.platform !== 'facebook'
  ) {
    return null;
  }

  const accountId =
    nonEmptyString(account.accountId) ?? nonEmptyString(account.id);
  const profileId = nonEmptyString(account.profileId);
  const commentId = nonEmptyString(comment.id);
  const platformPostId =
    nonEmptyString(comment.platformPostId) ??
    nonEmptyString(post.platformPostId);
  const providerPostId =
    nonEmptyString(comment.postId) ?? nonEmptyString(post.id) ?? platformPostId;
  const authorId = nonEmptyString(author?.id);
  const createdTime = normalizedTime(comment.createdAt);
  if (
    !accountId ||
    !profileId ||
    !commentId ||
    !platformPostId ||
    !providerPostId ||
    !authorId ||
    !createdTime
  ) {
    return null;
  }

  return {
    accountId,
    profileId,
    providerPostId,
    platformPostId,
    post: {
      zernioPostId: providerPostId,
      platformPostId,
      content: typeof post.content === 'string' ? post.content : null,
      picture: typeof post.imageUrl === 'string' ? post.imageUrl : null,
      permalink: typeof post.permalink === 'string' ? post.permalink : null,
      createdTime: normalizedTime(post.createdTime) ?? createdTime,
    },
    comment: {
      id: commentId,
      text:
        typeof comment.text === 'string' && comment.text.trim()
          ? comment.text
          : '[Facebook comment]',
      authorId,
      authorName: nonEmptyString(author.name),
      authorUsername: nonEmptyString(author.username),
      authorPicture: typeof author.picture === 'string' ? author.picture : null,
      isOwnAccount:
        typeof author.isOwnAccount === 'boolean' ? author.isOwnAccount : null,
      createdTime,
      isReply: comment.isReply === true,
      parentCommentId: nonEmptyString(comment.parentCommentId),
      url: typeof comment.url === 'string' ? comment.url : null,
    },
    rawPayload: payload,
  };
}

export interface FlattenedZernioComment extends ZernioInboxComment {
  parentCommentId: string | null;
  isReply: boolean;
}

/** Flatten Zernio's nested reply arrays into rows suitable for persistence. */
export function flattenZernioComments(
  comments: readonly ZernioInboxComment[]
): FlattenedZernioComment[] {
  const result: FlattenedZernioComment[] = [];

  const visit = (comment: ZernioInboxComment, parentId: string | null) => {
    const parentCommentId = parentId ?? comment.parentId ?? null;
    result.push({
      ...comment,
      parentCommentId,
      isReply: Boolean(parentCommentId),
    });
    for (const reply of comment.replies) visit(reply, comment.id);
  };

  for (const comment of comments) visit(comment, null);
  return result;
}

export interface ZernioPostRow {
  id: string;
  account_id: string;
  meta_channel_id: string | null;
  zernio_account_id: string;
  provider_post_id: string;
  platform_post_id: string;
  platform: 'facebook';
  content: string | null;
  picture: string | null;
  permalink: string | null;
  created_time: string | null;
  comment_count: number;
  like_count: number;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface ZernioCommentRow {
  id: string;
  account_id: string;
  social_post_id: string;
  zernio_account_id: string;
  provider_comment_id: string;
  platform_post_id: string;
  parent_comment_id: string | null;
  platform: 'facebook';
  message: string;
  author_id: string | null;
  author_name: string | null;
  author_username: string | null;
  author_picture: string | null;
  is_own_account: boolean | null;
  is_reply: boolean;
  created_time: string;
  comment_url: string | null;
  like_count: number;
  reply_count: number;
  can_reply: boolean;
  is_hidden: boolean;
  raw_payload: JsonRecord;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface StoredZernioPost extends ZernioPostRow {
  comments: ZernioCommentRow[];
}

async function upsertPost(
  db: SupabaseClient,
  args: {
    accountId: string;
    zernioAccountId: string;
    metaChannelId: string | null;
    providerPostId: string;
    platformPostId: string;
    content: string | null;
    picture: string | null;
    permalink: string | null;
    createdTime: string | null;
    commentCount: number;
    likeCount: number;
  }
): Promise<ZernioPostRow> {
  const { data, error } = await db
    .from('social_posts')
    .upsert(
      {
        account_id: args.accountId,
        meta_channel_id: args.metaChannelId,
        zernio_account_id: args.zernioAccountId,
        provider_post_id: args.providerPostId,
        platform_post_id: args.platformPostId,
        platform: 'facebook',
        content: args.content,
        picture: args.picture,
        permalink: args.permalink,
        created_time: args.createdTime,
        comment_count: args.commentCount,
        like_count: args.likeCount,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,zernio_account_id,provider_post_id' }
    )
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('Social post was not stored');
  return data as ZernioPostRow;
}

async function upsertComment(
  db: SupabaseClient,
  args: {
    accountId: string;
    zernioAccountId: string;
    socialPostId: string;
    platformPostId: string;
    providerCommentId: string;
    parentCommentId: string | null;
    message: string;
    authorId: string | null;
    authorName: string | null;
    authorUsername: string | null;
    authorPicture: string | null;
    isOwnAccount: boolean | null;
    isReply: boolean;
    createdTime: string;
    commentUrl: string | null;
    likeCount: number;
    replyCount: number;
    canReply: boolean;
    isHidden: boolean;
    rawPayload: JsonRecord;
  }
): Promise<ZernioCommentRow> {
  const { data, error } = await db
    .from('social_comments')
    .upsert(
      {
        account_id: args.accountId,
        social_post_id: args.socialPostId,
        zernio_account_id: args.zernioAccountId,
        provider_comment_id: args.providerCommentId,
        platform_post_id: args.platformPostId,
        parent_comment_id: args.parentCommentId,
        platform: 'facebook',
        message: args.message,
        author_id: args.authorId,
        author_name: args.authorName,
        author_username: args.authorUsername,
        author_picture: args.authorPicture,
        is_own_account: args.isOwnAccount,
        is_reply: args.isReply,
        created_time: args.createdTime,
        comment_url: args.commentUrl,
        like_count: args.likeCount,
        reply_count: args.replyCount,
        can_reply: args.canReply,
        is_hidden: args.isHidden,
        raw_payload: args.rawPayload,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,zernio_account_id,provider_comment_id' }
    )
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('Social comment was not stored');
  return data as ZernioCommentRow;
}

function commentRowArgs(
  accountId: string,
  zernioAccountId: string,
  socialPostId: string,
  platformPostId: string,
  comment: FlattenedZernioComment,
  rawPayload: JsonRecord = {}
) {
  return {
    accountId,
    zernioAccountId,
    socialPostId,
    platformPostId,
    providerCommentId: comment.id,
    parentCommentId: comment.parentCommentId,
    message: comment.message || '[Facebook comment]',
    authorId: comment.from.id,
    authorName: comment.from.name,
    authorUsername: comment.from.username,
    authorPicture: comment.from.picture,
    isOwnAccount: comment.from.isOwner,
    isReply: comment.isReply,
    createdTime:
      normalizedTime(comment.createdTime) ?? new Date().toISOString(),
    commentUrl: comment.url,
    likeCount: comment.likeCount,
    replyCount: comment.replyCount,
    canReply: comment.canReply,
    isHidden: comment.isHidden === true,
    rawPayload,
  };
}

/** Mirror one post and all returned top-level comments/replies locally. */
export async function persistZernioCommentedPost(
  db: SupabaseClient,
  args: {
    accountId: string;
    zernioAccountId: string;
    metaChannelId: string | null;
    post: ZernioCommentedPost;
    comments: readonly ZernioInboxComment[];
  }
): Promise<StoredZernioPost> {
  const post = await upsertPost(db, {
    accountId: args.accountId,
    zernioAccountId: args.zernioAccountId,
    metaChannelId: args.metaChannelId,
    providerPostId: args.post.id,
    platformPostId: args.post.platformPostId,
    content: args.post.content,
    picture: args.post.picture,
    permalink: args.post.permalink,
    createdTime: normalizedTime(args.post.createdTime),
    commentCount: args.post.commentCount,
    likeCount: args.post.likeCount,
  });
  const comments = [] as ZernioCommentRow[];
  for (const comment of flattenZernioComments(args.comments)) {
    comments.push(
      await upsertComment(
        db,
        commentRowArgs(
          args.accountId,
          args.zernioAccountId,
          post.id,
          post.platform_post_id,
          comment
        )
      )
    );
  }
  return { ...post, comments };
}

/** Mirror one comment.received delivery and its post reference locally. */
export async function persistZernioCommentEvent(
  db: SupabaseClient,
  args: {
    accountId: string;
    zernioAccountId: string;
    metaChannelId: string | null;
    event: ParsedZernioCommentEvent;
  }
): Promise<ZernioCommentRow> {
  const post = await upsertPost(db, {
    accountId: args.accountId,
    zernioAccountId: args.zernioAccountId,
    metaChannelId: args.metaChannelId,
    providerPostId: args.event.providerPostId,
    platformPostId: args.event.platformPostId,
    content: args.event.post.content,
    picture: args.event.post.picture,
    permalink: args.event.post.permalink,
    createdTime: args.event.post.createdTime,
    commentCount: 1,
    likeCount: 0,
  });
  return upsertComment(db, {
    accountId: args.accountId,
    zernioAccountId: args.zernioAccountId,
    socialPostId: post.id,
    platformPostId: args.event.platformPostId,
    providerCommentId: args.event.comment.id,
    parentCommentId: args.event.comment.parentCommentId,
    message: args.event.comment.text,
    authorId: args.event.comment.authorId,
    authorName: args.event.comment.authorName,
    authorUsername: args.event.comment.authorUsername,
    authorPicture: args.event.comment.authorPicture,
    isOwnAccount: args.event.comment.isOwnAccount,
    isReply: args.event.comment.isReply,
    createdTime: args.event.comment.createdTime,
    commentUrl: args.event.comment.url,
    likeCount: 0,
    replyCount: 0,
    canReply: true,
    isHidden: false,
    rawPayload: args.event.rawPayload,
  });
}

/** Persist the locally-visible row immediately after a successful reply. */
export async function persistZernioCommentReply(
  db: SupabaseClient,
  args: {
    accountId: string;
    zernioAccountId: string;
    providerPostId: string;
    providerCommentId: string;
    parentCommentId: string | null;
    message: string;
    isReply: boolean;
  }
): Promise<ZernioCommentRow> {
  const { data: post, error } = await db
    .from('social_posts')
    .select('id, platform_post_id')
    .eq('account_id', args.accountId)
    .eq('zernio_account_id', args.zernioAccountId)
    .eq('provider_post_id', args.providerPostId)
    .maybeSingle();
  if (error || !post) throw error ?? new Error('Social post was not found');

  return upsertComment(db, {
    accountId: args.accountId,
    zernioAccountId: args.zernioAccountId,
    socialPostId: post.id,
    platformPostId: post.platform_post_id,
    providerCommentId: args.providerCommentId,
    parentCommentId: args.parentCommentId,
    message: args.message,
    authorId: null,
    authorName: null,
    authorUsername: null,
    authorPicture: null,
    isOwnAccount: true,
    isReply: args.isReply,
    createdTime: new Date().toISOString(),
    commentUrl: null,
    likeCount: 0,
    replyCount: 0,
    canReply: true,
    isHidden: false,
    rawPayload: {},
  });
}

/** Read the account's mirrored comments for the CRM page. */
export async function listStoredZernioComments(
  db: SupabaseClient,
  args: { accountId: string; zernioAccountId: string }
): Promise<StoredZernioPost[]> {
  const { data: posts, error: postError } = await db
    .from('social_posts')
    .select('*')
    .eq('account_id', args.accountId)
    .eq('zernio_account_id', args.zernioAccountId)
    .order('created_time', { ascending: false })
    .limit(50);
  if (postError) throw postError;
  if (!posts?.length) return [];

  const postIds = posts.map((post: ZernioPostRow) => post.id);
  const { data: comments, error: commentError } = await db
    .from('social_comments')
    .select('*')
    .eq('account_id', args.accountId)
    .eq('zernio_account_id', args.zernioAccountId)
    .in('social_post_id', postIds)
    .order('created_time', { ascending: true });
  if (commentError) throw commentError;

  const byPost = new Map<string, ZernioCommentRow[]>();
  for (const comment of (comments ?? []) as ZernioCommentRow[]) {
    const current = byPost.get(comment.social_post_id) ?? [];
    current.push(comment);
    byPost.set(comment.social_post_id, current);
  }
  return (posts as ZernioPostRow[]).map((post) => ({
    ...post,
    comments: byPost.get(post.id) ?? [],
  }));
}
