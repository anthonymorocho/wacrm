import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const auth = vi.hoisted(() => ({
  requireRole: vi.fn(),
  toErrorResponse: vi.fn((error: { message?: string; status?: number }) =>
    NextResponse.json(
      { error: error.message ?? 'Internal server error' },
      { status: error.status ?? 500 }
    )
  ),
}));
const embedded = vi.hoisted(() => ({
  exchangeEmbeddedSignupCode: vi.fn(),
  validateEmbeddedSignupMetaData: vi.fn(),
}));
const configure = vi.hoisted(() => ({
  finalizeWhatsAppConfiguration: vi.fn(),
}));
const metaClient = vi.hoisted(() => ({
  createClient: vi.fn(() => ({}) as unknown),
  createAdminClient: vi.fn(() => ({}) as unknown),
}));

vi.mock('@/lib/auth/account', () => auth);
vi.mock('@/lib/whatsapp/embedded-signup', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/whatsapp/embedded-signup')
  >('@/lib/whatsapp/embedded-signup');
  return { ...actual, ...embedded };
});
vi.mock('@/lib/whatsapp/configure', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/whatsapp/configure')
  >('@/lib/whatsapp/configure');
  return { ...actual, ...configure };
});
vi.mock('@supabase/supabase-js', () => metaClient);

import { GET, POST } from './route';

const context = {
  supabase: {},
  userId: 'user-1',
  accountId: 'account-1',
  role: 'admin',
  account: { id: 'account-1', name: 'Acme' },
};

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/whatsapp/embedded-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

describe('/api/whatsapp/embedded-signup', () => {
  beforeEach(() => {
    process.env.META_APP_ID = 'app-id';
    process.env.META_APP_SECRET = 'app-secret';
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = 'config-id';
    auth.requireRole.mockResolvedValue(context);
    embedded.exchangeEmbeddedSignupCode.mockResolvedValue({
      accessToken: 'exchanged-token',
      expiresIn: 3600,
      tokenExpiresAt: new Date('2026-09-10T12:00:00.000Z'),
    });
    embedded.validateEmbeddedSignupMetaData.mockResolvedValue({
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
      phoneInfo: { id: 'phone-1', display_phone_number: '+593999999999' },
    });
    configure.finalizeWhatsAppConfiguration.mockResolvedValue({
      saved: true,
      registered: true,
      registrationSkipped: false,
      registrationError: null,
      phoneInfo: { id: 'phone-1', display_phone_number: '+593999999999' },
    });
  });

  afterEach(() => {
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    delete process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
    vi.clearAllMocks();
  });

  it('returns only safe public configuration to an admin', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      app_id: 'app-id',
      config_id: 'config-id',
    });
  });

  it('does not expose configuration to a non-admin', async () => {
    const forbidden = Object.assign(new Error('Insufficient role'), {
      status: 403,
    });
    auth.requireRole.mockRejectedValueOnce(forbidden);

    const response = await GET();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Insufficient role' });
  });

  it('reports missing server configuration without revealing secrets', async () => {
    delete process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;

    const response = await GET();

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/not configured/i);
    expect(JSON.stringify(body)).not.toContain('app-secret');
  });

  it('rejects malformed onboarding input before contacting Meta', async () => {
    const response = await post({ code: 'only-code' });

    expect(response.status).toBe(400);
    expect(embedded.exchangeEmbeddedSignupCode).not.toHaveBeenCalled();
    expect(configure.finalizeWhatsAppConfiguration).not.toHaveBeenCalled();
  });

  it('exchanges and validates the flow, then persists without returning the token', async () => {
    const response = await post({
      code: 'auth-code',
      waba_id: 'waba-1',
      phone_number_id: 'phone-1',
      pin: '123456',
      verify_token: 'verify-me',
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      registered: true,
      phone_info: { id: 'phone-1' },
    });
    expect(JSON.stringify(body)).not.toContain('exchanged-token');
    expect(embedded.exchangeEmbeddedSignupCode).toHaveBeenCalledWith({
      code: 'auth-code',
      appId: 'app-id',
      appSecret: 'app-secret',
    });
    expect(embedded.validateEmbeddedSignupMetaData).toHaveBeenCalledWith({
      accessToken: 'exchanged-token',
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
    });
    expect(configure.finalizeWhatsAppConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        userId: 'user-1',
        accessToken: 'exchanged-token',
        tokenExpiresAt: '2026-09-10T12:00:00.000Z',
      })
    );
  });

  it('returns an actionable 400 when Meta rejects the authorization', async () => {
    embedded.exchangeEmbeddedSignupCode.mockRejectedValueOnce(
      new Error('Meta rejected the Embedded Signup authorization')
    );

    const response = await post({
      code: 'auth-code',
      waba_id: 'waba-1',
      phone_number_id: 'phone-1',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Meta rejected the Embedded Signup authorization',
    });
    expect(configure.finalizeWhatsAppConfiguration).not.toHaveBeenCalled();
  });
});
