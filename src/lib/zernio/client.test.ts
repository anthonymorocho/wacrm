import { afterEach, describe, expect, it, vi } from 'vitest';

import { getFacebookPageSelection, getZernioConnectUrl } from './client';

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
});
