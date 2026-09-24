const ZERNIO_API_BASE = 'https://zernio.com/api';

export class ZernioConfigurationError extends Error {
  readonly status = 503 as const;

  constructor(message = 'Zernio is not configured for this account') {
    super(message);
    this.name = 'ZernioConfigurationError';
  }
}

export class ZernioApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown> | null;

  constructor(status: number, body: Record<string, unknown> | null) {
    super(
      typeof body?.error === 'string'
        ? body.error
        : `Zernio API request failed (${status})`
    );
    this.name = 'ZernioApiError';
    this.status = status;
    this.body = body;
  }
}

export type ZernioSocialPlatform = 'facebook' | 'instagram';
export type ZernioProvider = 'messenger' | 'instagram';

function getApiKey(apiKey: string): string {
  const normalized = apiKey.trim();
  if (!normalized) {
    throw new ZernioConfigurationError('Zernio API key is required');
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function zernioRequest<T>(
  apiKey: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${getApiKey(apiKey)}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`${ZERNIO_API_BASE}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('Could not connect to Zernio');
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new ZernioApiError(response.status, isRecord(body) ? body : null);
  }

  return body as T;
}

export async function getZernioConnectUrl(args: {
  apiKey: string;
  profileId: string;
  redirectUrl: string;
  platform?: ZernioSocialPlatform;
}): Promise<string> {
  const query = new URLSearchParams({
    profileId: args.profileId,
    redirect_url: args.redirectUrl,
  });
  const result = await zernioRequest<{ authUrl?: unknown }>(
    args.apiKey,
    `/v1/connect/${args.platform ?? 'facebook'}?${query.toString()}`
  );
  if (typeof result.authUrl !== 'string' || !result.authUrl) {
    throw new Error('Zernio did not return an authorization URL');
  }
  return result.authUrl;
}

export interface ZernioConnectedAccount {
  id: string;
  platform: string;
  username: string | null;
  displayName: string | null;
  isActive: boolean;
}

/** List connected accounts for one profile so OAuth callbacks can be verified. */
export async function listZernioAccounts(args: {
  apiKey: string;
  profileId: string;
}): Promise<ZernioConnectedAccount[]> {
  const query = new URLSearchParams({ profileId: args.profileId });
  const result = await zernioRequest<{ accounts?: unknown }>(
    args.apiKey,
    `/v1/accounts?${query.toString()}`
  );
  if (!Array.isArray(result.accounts)) return [];

  return result.accounts.flatMap((value): ZernioConnectedAccount[] => {
    if (!isRecord(value)) return [];
    const id =
      typeof value._id === 'string'
        ? value._id
        : typeof value.accountId === 'string'
          ? value.accountId
          : null;
    if (!id || typeof value.platform !== 'string') return [];
    return [
      {
        id,
        platform: value.platform,
        username: typeof value.username === 'string' ? value.username : null,
        displayName:
          typeof value.displayName === 'string' ? value.displayName : null,
        isActive: value.isActive === true,
      },
    ];
  });
}

export interface ZernioProfile {
  _id: string;
  name?: string;
}

export async function listZernioProfiles(args: {
  apiKey: string;
  name: string;
}): Promise<ZernioProfile[]> {
  const query = new URLSearchParams({ name: args.name, limit: '1' });
  const result = await zernioRequest<{ profiles?: unknown }>(
    args.apiKey,
    `/v1/profiles?${query.toString()}`
  );
  if (!Array.isArray(result.profiles)) return [];
  return result.profiles.filter(
    (profile): profile is ZernioProfile =>
      isRecord(profile) && typeof profile._id === 'string'
  );
}

export async function createZernioProfile(args: {
  apiKey: string;
  name: string;
  description: string;
  idempotencyKey: string;
}): Promise<ZernioProfile> {
  try {
    const result = await zernioRequest<{ profile?: unknown }>(
      args.apiKey,
      '/v1/profiles',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': args.idempotencyKey },
        body: JSON.stringify({
          name: args.name,
          description: args.description,
        }),
      }
    );
    if (!isRecord(result.profile) || typeof result.profile._id !== 'string') {
      throw new Error('Zernio did not return the created profile');
    }
    return result.profile as unknown as ZernioProfile;
  } catch (error) {
    if (!(error instanceof ZernioApiError) || error.status !== 409) {
      throw error;
    }

    const existing = await listZernioProfiles({
      apiKey: args.apiKey,
      name: args.name,
    });
    if (existing[0]) return existing[0];
    throw error;
  }
}

export interface ZernioFacebookPageSelection {
  pageId: string;
  pageName: string | null;
}

export async function getFacebookPageSelection(args: {
  apiKey: string;
  accountId: string;
}): Promise<ZernioFacebookPageSelection> {
  const result = await zernioRequest<{
    pages?: unknown;
    selectedPageId?: unknown;
  }>(
    args.apiKey,
    `/v1/accounts/${encodeURIComponent(args.accountId)}/facebook-page`
  );
  const pages = Array.isArray(result.pages)
    ? result.pages.filter(isRecord)
    : [];
  const selectedPageId =
    typeof result.selectedPageId === 'string' ? result.selectedPageId : null;
  const selectedPage = selectedPageId
    ? (pages.find((candidate) => candidate.id === selectedPageId) ?? null)
    : null;
  const page = selectedPage ?? (pages.length === 1 ? pages[0] : null);
  const pageId = typeof page?.id === 'string' ? page.id : null;
  if (!pageId)
    throw new Error('Zernio did not return the selected Facebook Page');

  return {
    pageId,
    pageName: typeof page?.name === 'string' ? page.name : null,
  };
}

export async function ensureZernioWebhook(args: {
  apiKey: string;
  url: string;
  secret: string;
}): Promise<string> {
  const events = [
    'message.received',
    'comment.received',
    'account.disconnected',
  ];
  const listed = await zernioRequest<{ webhooks?: unknown }>(
    args.apiKey,
    '/v1/webhooks/settings'
  );
  const webhooks = Array.isArray(listed.webhooks)
    ? listed.webhooks.filter(isRecord)
    : [];
  const existing = webhooks.find(
    (webhook) => webhook.url === args.url && typeof webhook._id === 'string'
  );

  if (existing && typeof existing._id === 'string') {
    await zernioRequest(args.apiKey, '/v1/webhooks/settings', {
      method: 'PUT',
      body: JSON.stringify({
        _id: existing._id,
        url: args.url,
        secret: args.secret,
        events,
        isActive: true,
      }),
    });
    return existing._id;
  }

  const created = await zernioRequest<{ webhook?: unknown }>(
    args.apiKey,
    '/v1/webhooks/settings',
    {
      method: 'POST',
      headers: { 'Idempotency-Key': `wacrm-${args.url}` },
      body: JSON.stringify({
        name: 'wacrm Messenger inbox',
        url: args.url,
        secret: args.secret,
        events,
        isActive: true,
      }),
    }
  );
  if (!isRecord(created.webhook) || typeof created.webhook._id !== 'string') {
    throw new Error('Zernio did not return the created webhook');
  }
  return created.webhook._id;
}

export interface ZernioCommentedPost {
  id: string;
  platform: ZernioSocialPlatform;
  accountId: string;
  /** Present in some API versions; falls back to the provider post id. */
  platformPostId: string;
  accountUsername: string | null;
  content: string | null;
  picture: string | null;
  permalink: string | null;
  createdTime: string | null;
  commentCount: number;
  likeCount: number;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeCommentedPost(value: unknown): ZernioCommentedPost | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    (value.platform !== 'facebook' && value.platform !== 'instagram')
  ) {
    return null;
  }
  return {
    id: value.id,
    platform: value.platform,
    accountId: typeof value.accountId === 'string' ? value.accountId : '',
    platformPostId:
      typeof value.platformPostId === 'string'
        ? value.platformPostId
        : value.id,
    accountUsername:
      typeof value.accountUsername === 'string' ? value.accountUsername : null,
    content: typeof value.content === 'string' ? value.content : null,
    picture: typeof value.picture === 'string' ? value.picture : null,
    permalink: typeof value.permalink === 'string' ? value.permalink : null,
    createdTime:
      typeof value.createdTime === 'string' ? value.createdTime : null,
    commentCount: numberValue(value.commentCount),
    likeCount: numberValue(value.likeCount),
  };
}

/** List posts with comments for one connected Zernio account. */
export async function listZernioCommentedPosts(args: {
  apiKey: string;
  accountId: string;
  platform?: ZernioSocialPlatform;
  limit?: number;
  cursor?: string | null;
}): Promise<ZernioCommentedPost[]> {
  const query = new URLSearchParams({
    accountId: args.accountId,
    limit: String(args.limit ?? 25),
  });
  if (args.platform) query.set('platform', args.platform);
  if (args.cursor) query.set('cursor', args.cursor);

  const result = await zernioRequest<{ data?: unknown }>(
    args.apiKey,
    `/v1/inbox/comments?${query.toString()}`
  );
  if (!Array.isArray(result.data)) return [];
  return result.data.flatMap((value): ZernioCommentedPost[] => {
    const post = normalizeCommentedPost(value);
    return post ? [post] : [];
  });
}

export interface ZernioInboxComment {
  id: string;
  message: string;
  createdTime: string;
  from: {
    id: string | null;
    name: string | null;
    username: string | null;
    picture: string | null;
    isOwner: boolean | null;
  };
  likeCount: number;
  replyCount: number;
  platform?: string;
  url: string | null;
  replies: ZernioInboxComment[];
  canReply: boolean;
  parentId?: string | null;
  isHidden?: boolean;
}

function normalizeInboxComment(value: unknown): ZernioInboxComment | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    return null;
  }
  const from = isRecord(value.from) ? value.from : null;
  const replies = Array.isArray(value.replies)
    ? value.replies.flatMap((reply): ZernioInboxComment[] => {
        const normalized = normalizeInboxComment(reply);
        return normalized ? [normalized] : [];
      })
    : [];
  return {
    id: value.id,
    message: typeof value.message === 'string' ? value.message : '',
    createdTime:
      typeof value.createdTime === 'string'
        ? value.createdTime
        : new Date().toISOString(),
    from: {
      id: typeof from?.id === 'string' ? from.id : null,
      name: typeof from?.name === 'string' ? from.name : null,
      username: typeof from?.username === 'string' ? from.username : null,
      picture: typeof from?.picture === 'string' ? from.picture : null,
      isOwner: typeof from?.isOwner === 'boolean' ? from.isOwner : null,
    },
    likeCount: numberValue(value.likeCount),
    replyCount: numberValue(value.replyCount),
    platform: typeof value.platform === 'string' ? value.platform : undefined,
    url: typeof value.url === 'string' ? value.url : null,
    replies,
    canReply: value.canReply !== false,
    parentId: typeof value.parentId === 'string' ? value.parentId : null,
    isHidden: typeof value.isHidden === 'boolean' ? value.isHidden : undefined,
  };
}

export interface ZernioInboxPostComments {
  comments: ZernioInboxComment[];
  hasMore: boolean;
  cursor: string | null;
}

/** Read one post's current public comment thread. */
export async function getZernioInboxPostComments(args: {
  apiKey: string;
  accountId: string;
  postId: string;
  limit?: number;
  cursor?: string | null;
}): Promise<ZernioInboxPostComments> {
  const query = new URLSearchParams({
    accountId: args.accountId,
    limit: String(args.limit ?? 100),
  });
  if (args.cursor) query.set('cursor', args.cursor);
  const result = await zernioRequest<{
    comments?: unknown;
    pagination?: unknown;
  }>(
    args.apiKey,
    `/v1/inbox/comments/${encodeURIComponent(args.postId)}?${query.toString()}`
  );
  const comments = Array.isArray(result.comments)
    ? result.comments.flatMap((value): ZernioInboxComment[] => {
        const normalized = normalizeInboxComment(value);
        return normalized ? [normalized] : [];
      })
    : [];
  const pagination = isRecord(result.pagination) ? result.pagination : null;
  return {
    comments,
    hasMore: pagination?.hasMore === true,
    cursor: typeof pagination?.cursor === 'string' ? pagination.cursor : null,
  };
}

export interface ZernioCommentReplyResult {
  commentId: string;
  isReply: boolean;
}

/** Reply publicly to an organic post or one of its comments. */
export async function replyToZernioInboxPost(args: {
  apiKey: string;
  accountId: string;
  postId: string;
  commentId?: string | null;
  message: string;
  idempotencyKey: string;
}): Promise<ZernioCommentReplyResult> {
  const body: Record<string, string> = {
    accountId: args.accountId,
    message: args.message,
  };
  if (args.commentId) body.commentId = args.commentId;
  const result = await zernioRequest<{ data?: unknown }>(
    args.apiKey,
    `/v1/inbox/comments/${encodeURIComponent(args.postId)}`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': args.idempotencyKey },
      body: JSON.stringify(body),
    }
  );
  const data = isRecord(result.data) ? result.data : null;
  if (
    !data ||
    typeof data.commentId !== 'string' ||
    typeof data.isReply !== 'boolean'
  ) {
    throw new Error('Zernio did not return the posted comment');
  }
  return { commentId: data.commentId, isReply: data.isReply };
}

export interface ZernioInboxMessageResult {
  messageId: string;
  conversationId: string;
}

/** Send a text message through an existing Zernio inbox conversation. */
export async function sendZernioInboxMessage(args: {
  apiKey: string;
  accountId: string;
  conversationId: string;
  message: string;
  idempotencyKey: string;
}): Promise<ZernioInboxMessageResult> {
  const result = await zernioRequest<{ data?: unknown }>(
    args.apiKey,
    `/v1/inbox/conversations/${encodeURIComponent(args.conversationId)}/messages`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': args.idempotencyKey },
      body: JSON.stringify({
        accountId: args.accountId,
        message: args.message,
      }),
    }
  );
  const data = isRecord(result.data) ? result.data : null;
  if (
    !data ||
    typeof data.messageId !== 'string' ||
    typeof data.conversationId !== 'string'
  ) {
    throw new Error('Zernio did not return the sent inbox message');
  }
  return {
    messageId: data.messageId,
    conversationId: data.conversationId,
  };
}

export interface ZernioInboxConversation {
  id: string;
  accountId: string;
  platform: string;
  participantId: string | null;
}

/** List a bounded page of conversations for recovering older CRM threads. */
export async function listZernioInboxConversations(args: {
  apiKey: string;
  accountId: string;
  platform?: string;
  limit?: number;
}): Promise<ZernioInboxConversation[]> {
  const query = new URLSearchParams({
    accountId: args.accountId,
    limit: String(args.limit ?? 100),
  });
  if (args.platform) query.set('platform', args.platform);

  const result = await zernioRequest<{ data?: unknown }>(
    args.apiKey,
    `/v1/inbox/conversations?${query.toString()}`
  );
  if (!Array.isArray(result.data)) return [];

  return result.data.flatMap((value): ZernioInboxConversation[] => {
    if (!isRecord(value) || typeof value.id !== 'string') return [];
    return [
      {
        id: value.id,
        accountId: typeof value.accountId === 'string' ? value.accountId : '',
        platform: typeof value.platform === 'string' ? value.platform : '',
        participantId:
          typeof value.participantId === 'string' ? value.participantId : null,
      },
    ];
  });
}
