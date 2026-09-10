import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const meta = vi.hoisted(() => ({
  registerPhoneNumber: vi.fn(),
  subscribeWabaToApp: vi.fn(),
  verifyPhoneNumber: vi.fn(),
}));
const crypto = vi.hoisted(() => ({
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
}));

vi.mock('./meta-api', () => meta);
vi.mock('./encryption', () => crypto);

import {
  finalizeWhatsAppConfiguration,
  WhatsAppConfigurationError,
} from './configure';

type Result = { data: unknown; error: unknown };

function makeClient(options: {
  existing?: Record<string, unknown> | null;
  claimed?: Record<string, unknown> | null;
  inserts?: Array<Record<string, unknown>>;
  updates?: Array<Record<string, unknown>>;
  admin?: boolean;
}): SupabaseClient {
  const client = {
    from() {
      let operation: 'select' | 'insert' | 'update' = 'select';
      const builder: Record<string, unknown> = {};

      builder.select = vi.fn(() => {
        operation = 'select';
        return builder;
      });
      builder.eq = vi.fn(() => builder);
      builder.neq = vi.fn(() => builder);
      builder.insert = vi.fn((row: Record<string, unknown>) => {
        operation = 'insert';
        options.inserts?.push(row);
        return builder;
      });
      builder.update = vi.fn((row: Record<string, unknown>) => {
        operation = 'update';
        options.updates?.push(row);
        return builder;
      });
      builder.maybeSingle = vi.fn(async () => {
        if (options.admin)
          return { data: options.claimed ?? null, error: null };
        return { data: options.existing ?? null, error: null };
      });
      builder.then = (...args: unknown[]) => {
        const resolve = args[0] as (value: Result) => unknown;
        const reject = args[1] as ((reason: unknown) => unknown) | undefined;
        const value: Result =
          operation === 'select'
            ? { data: options.existing ?? null, error: null }
            : { data: null, error: null };
        return Promise.resolve(value).then(resolve, reject);
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  return client;
}

const BASE_ARGS = {
  accountId: 'account-1',
  userId: 'user-1',
  phoneNumberId: 'phone-1',
  wabaId: 'waba-1',
  accessToken: 'short-lived-token',
  verifyToken: 'verify-me',
  pin: '123456',
  tokenExpiresAt: '2026-09-10T12:00:00.000Z',
  appSecret: 'app-secret',
};

describe('finalizeWhatsAppConfiguration', () => {
  beforeEach(() => {
    meta.verifyPhoneNumber.mockResolvedValue({
      id: 'phone-1',
      display_phone_number: '+593999999999',
      verified_name: 'Acme',
    });
    meta.registerPhoneNumber.mockResolvedValue({
      success: true,
      alreadyRegistered: false,
    });
    meta.subscribeWabaToApp.mockResolvedValue(undefined);
    crypto.encrypt.mockImplementation((value: string) => `encrypted:${value}`);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('verifies, registers, subscribes, encrypts, and persists expiry', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const result = await finalizeWhatsAppConfiguration({
      ...BASE_ARGS,
      supabase: makeClient({ inserts, updates }),
      supabaseAdmin: makeClient({ admin: true }),
    });

    expect(result).toMatchObject({
      saved: true,
      registered: true,
      registrationSkipped: false,
      registrationError: null,
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      account_id: 'account-1',
      user_id: 'user-1',
      phone_number_id: 'phone-1',
      waba_id: 'waba-1',
      access_token: 'encrypted:short-lived-token',
      app_secret: 'encrypted:app-secret',
      verify_token: 'encrypted:verify-me',
      token_expires_at: '2026-09-10T12:00:00.000Z',
      status: 'connected',
    });
    expect(meta.verifyPhoneNumber).toHaveBeenCalledWith({
      phoneNumberId: 'phone-1',
      accessToken: 'short-lived-token',
    });
    expect(meta.registerPhoneNumber).toHaveBeenCalledWith({
      phoneNumberId: 'phone-1',
      accessToken: 'short-lived-token',
      pin: '123456',
    });
    expect(meta.subscribeWabaToApp).toHaveBeenCalledWith({
      wabaId: 'waba-1',
      accessToken: 'short-lived-token',
    });
    expect(updates).toHaveLength(0);
  });

  it('leaves the saved row untouched when another account owns the phone', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    await expect(
      finalizeWhatsAppConfiguration({
        ...BASE_ARGS,
        supabase: makeClient({ inserts }),
        supabaseAdmin: makeClient({
          admin: true,
          claimed: { account_id: 'other-account' },
        }),
      })
    ).rejects.toMatchObject({ status: 409 } as WhatsAppConfigurationError);

    expect(meta.verifyPhoneNumber).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it('saves valid credentials when registration is skipped without a PIN', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    const result = await finalizeWhatsAppConfiguration({
      ...BASE_ARGS,
      pin: null,
      supabase: makeClient({ inserts }),
      supabaseAdmin: makeClient({ admin: true }),
    });

    expect(result).toMatchObject({
      saved: true,
      registered: false,
      registrationSkipped: true,
      registrationError: null,
    });
    expect(meta.registerPhoneNumber).not.toHaveBeenCalled();
    expect(inserts[0].status).toBe('connected');
  });

  it('persists credentials and reports a registration error when Meta rejects the PIN', async () => {
    meta.registerPhoneNumber.mockRejectedValueOnce(
      new Error('Two-step verification PIN required')
    );
    const inserts: Array<Record<string, unknown>> = [];

    const result = await finalizeWhatsAppConfiguration({
      ...BASE_ARGS,
      supabase: makeClient({ inserts }),
      supabaseAdmin: makeClient({ admin: true }),
    });

    expect(result).toMatchObject({
      saved: true,
      registered: false,
      registrationSkipped: false,
      registrationError: 'Two-step verification PIN required',
    });
    expect(inserts[0]).toMatchObject({
      status: 'disconnected',
      connected_at: null,
      last_registration_error: 'Two-step verification PIN required',
    });
  });
});
