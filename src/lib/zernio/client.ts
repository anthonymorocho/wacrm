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
}): Promise<string> {
  const query = new URLSearchParams({
    profileId: args.profileId,
    redirect_url: args.redirectUrl,
  });
  const result = await zernioRequest<{ authUrl?: unknown }>(
    args.apiKey,
    `/v1/connect/facebook?${query.toString()}`
  );
  if (typeof result.authUrl !== 'string' || !result.authUrl) {
    throw new Error('Zernio did not return an authorization URL');
  }
  return result.authUrl;
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
  const events = ['message.received', 'account.disconnected'];
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
