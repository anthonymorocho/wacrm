import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMBEDDED_SIGNUP_MAX_LENGTH,
  exchangeEmbeddedSignupCode,
  validateEmbeddedSignupMetaData,
  validateEmbeddedSignupPayload,
} from './embedded-signup';

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('validateEmbeddedSignupPayload', () => {
  it('accepts the Meta code and selected IDs', () => {
    expect(
      validateEmbeddedSignupPayload({
        code: 'short-lived-code',
        waba_id: 'waba-123',
        phone_number_id: 'phone-123',
        pin: '123456',
        verify_token: 'crm-webhook-token',
      })
    ).toEqual({
      code: 'short-lived-code',
      wabaId: 'waba-123',
      phoneNumberId: 'phone-123',
      pin: '123456',
      verifyToken: 'crm-webhook-token',
    });
  });

  it.each([
    ['code', { waba_id: 'waba', phone_number_id: 'phone' }],
    ['waba_id', { code: 'code', phone_number_id: 'phone' }],
    ['phone_number_id', { code: 'code', waba_id: 'waba' }],
  ])('rejects a missing %s', (_field, input) => {
    expect(() => validateEmbeddedSignupPayload(input)).toThrow(/required/i);
  });

  it('rejects non-string and overlong values', () => {
    expect(() =>
      validateEmbeddedSignupPayload({
        code: 123,
        waba_id: 'waba',
        phone_number_id: 'phone',
      })
    ).toThrow(/code/i);

    expect(() =>
      validateEmbeddedSignupPayload({
        code: 'x'.repeat(EMBEDDED_SIGNUP_MAX_LENGTH + 1),
        waba_id: 'waba',
        phone_number_id: 'phone',
      })
    ).toThrow(/code/i);
  });

  it('rejects a malformed optional PIN', () => {
    expect(() =>
      validateEmbeddedSignupPayload({
        code: 'code',
        waba_id: 'waba',
        phone_number_id: 'phone',
        pin: '1234',
      })
    ).toThrow(/PIN/i);
  });
});

describe('exchangeEmbeddedSignupCode', () => {
  it('exchanges the code server-side and returns token expiry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse({ access_token: 'returned-token', expires_in: 3600 })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await exchangeEmbeddedSignupCode({
      code: 'auth-code',
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    expect(result.accessToken).toBe('returned-token');
    expect(result.expiresIn).toBe(3600);
    expect(result.tokenExpiresAt).toBeInstanceOf(Date);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toContain('/oauth/access_token');
    expect(parsed.searchParams.get('client_id')).toBe('app-id');
    expect(parsed.searchParams.get('client_secret')).toBe('app-secret');
    expect(parsed.searchParams.get('code')).toBe('auth-code');
    expect(init.method).toBe('GET');
  });

  it('does not expose Meta response bodies on exchange failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        errorResponse(400, {
          error: { message: 'OAuth code is invalid', access_token: 'secret' },
        })
      )
    );

    const error = await exchangeEmbeddedSignupCode({
      code: 'bad-code',
      appId: 'app-id',
      appSecret: 'app-secret',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(
      /Meta rejected the Embedded Signup authorization/i
    );
    expect((error as Error).message).not.toMatch(/access_token|secret/i);
  });
});

describe('validateEmbeddedSignupMetaData', () => {
  it('requires the phone number to belong to the selected WABA', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ id: 'waba-123' }))
      .mockResolvedValueOnce(okResponse({ data: [{ id: 'different-phone' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      validateEmbeddedSignupMetaData({
        accessToken: 'token',
        wabaId: 'waba-123',
        phoneNumberId: 'phone-123',
      })
    ).rejects.toThrow(/does not belong to the selected WABA/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns verified phone metadata after WABA ownership checks', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ id: 'waba-123' }))
      .mockResolvedValueOnce(okResponse({ data: [{ id: 'phone-123' }] }))
      .mockResolvedValueOnce(
        okResponse({
          id: 'phone-123',
          display_phone_number: '+593999999999',
          verified_name: 'Acme',
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateEmbeddedSignupMetaData({
      accessToken: 'token',
      wabaId: 'waba-123',
      phoneNumberId: 'phone-123',
    });

    expect(result).toEqual({
      wabaId: 'waba-123',
      phoneNumberId: 'phone-123',
      phoneInfo: {
        id: 'phone-123',
        display_phone_number: '+593999999999',
        verified_name: 'Acme',
      },
    });
  });
});
