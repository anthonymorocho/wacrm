import type { SupabaseClient } from '@supabase/supabase-js';
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
  type MetaPhoneInfo,
} from './meta-api';
import { encrypt } from './encryption';

export class WhatsAppConfigurationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 500
  ) {
    super(message);
    this.name = 'WhatsAppConfigurationError';
  }
}

export interface FinalizeWhatsAppConfigurationArgs {
  supabase: SupabaseClient;
  supabaseAdmin: SupabaseClient;
  accountId: string;
  userId: string;
  phoneNumberId: string;
  wabaId: string | null;
  accessToken: string;
  verifyToken?: string | null;
  pin?: string | null;
  tokenExpiresAt?: string | null;
  appSecret?: string | null;
}

export interface FinalizeWhatsAppConfigurationResult {
  saved: true;
  phoneInfo: MetaPhoneInfo;
  registered: boolean;
  registrationSkipped: boolean;
  registrationError: string | null;
}

interface ExistingWhatsAppConfig {
  registered_at?: string | null;
  subscribed_apps_at?: string | null;
  last_registration_error?: string | null;
  phone_number_id?: string | null;
  access_token?: string | null;
  app_secret?: string | null;
  verify_token?: string | null;
  token_expires_at?: string | null;
}

function configurationFailure(message: string): never {
  throw new WhatsAppConfigurationError(message, 500);
}

/**
 * Shared account-level write path for manual setup and Embedded Signup.
 * Meta verification happens before encryption/persistence, and ownership is
 * checked with the service-role client so RLS cannot hide another account's
 * claim on the same phone number.
 */
export async function finalizeWhatsAppConfiguration(
  args: FinalizeWhatsAppConfigurationArgs
): Promise<FinalizeWhatsAppConfigurationResult> {
  const {
    supabase,
    supabaseAdmin,
    accountId,
    userId,
    phoneNumberId,
    wabaId,
    accessToken,
    verifyToken,
    pin,
    tokenExpiresAt,
    appSecret,
  } = args;

  if (pin !== undefined && pin !== null && pin !== '' && !/^\d{6}$/.test(pin)) {
    throw new WhatsAppConfigurationError('PIN must be exactly 6 digits.', 400);
  }

  const { data: claimed, error: claimedError } = await supabaseAdmin
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', phoneNumberId)
    .neq('account_id', accountId)
    .maybeSingle();

  if (claimedError) {
    console.error('[whatsapp/configure] ownership check failed');
    configurationFailure('Failed to validate configuration');
  }

  if (claimed) {
    throw new WhatsAppConfigurationError(
      'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one CRM user.',
      409
    );
  }

  const { data: existing, error: existingError } = (await supabase
    .from('whatsapp_config')
    .select(
      'registered_at, subscribed_apps_at, last_registration_error, phone_number_id, app_secret, verify_token, token_expires_at'
    )
    .eq('account_id', accountId)
    .maybeSingle()) as {
    data: ExistingWhatsAppConfig | null;
    error: unknown;
  };

  if (existingError) {
    console.error('[whatsapp/configure] existing config lookup failed');
    configurationFailure('Failed to load existing configuration');
  }

  let phoneInfo: MetaPhoneInfo;
  try {
    phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken });
  } catch {
    throw new WhatsAppConfigurationError(
      'Meta API rejected the phone number credentials',
      400
    );
  }

  let encryptedAccessToken: string;
  let encryptedAppSecret: string | null;
  let encryptedVerifyToken: string | null;
  try {
    encryptedAccessToken = encrypt(accessToken);
    encryptedAppSecret =
      appSecret === undefined
        ? (existing?.app_secret ?? null)
        : appSecret?.trim()
          ? encrypt(appSecret.trim())
          : null;
    encryptedVerifyToken =
      verifyToken === undefined
        ? (existing?.verify_token ?? null)
        : verifyToken?.trim()
          ? encrypt(verifyToken.trim())
          : null;
  } catch {
    throw new WhatsAppConfigurationError(
      'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
      500
    );
  }

  const sameNumber =
    existing?.phone_number_id === phoneNumberId &&
    existing.registered_at != null;
  const needsRegistration = !sameNumber || Boolean(pin);
  let registeredAt = existing?.registered_at ?? null;
  let registrationError: string | null = null;
  let registrationSkipped = false;

  if (needsRegistration) {
    if (!pin) {
      registrationSkipped = true;
    } else {
      try {
        await registerPhoneNumber({ phoneNumberId, accessToken, pin });
        registeredAt = new Date().toISOString();
      } catch (error) {
        registrationError =
          error instanceof Error ? error.message : 'Phone registration failed';
        console.error('[whatsapp/configure] phone registration failed');
      }
    }
  }

  let subscribedAppsAt = existing?.subscribed_apps_at ?? null;
  if (wabaId) {
    try {
      await subscribeWabaToApp({ wabaId, accessToken });
      subscribedAppsAt = new Date().toISOString();
    } catch {
      console.warn('[whatsapp/configure] WABA subscription failed');
    }
  }

  const row = {
    phone_number_id: phoneNumberId,
    waba_id: wabaId,
    access_token: encryptedAccessToken,
    app_secret: encryptedAppSecret,
    verify_token: encryptedVerifyToken,
    token_expires_at:
      tokenExpiresAt === undefined
        ? (existing?.token_expires_at ?? null)
        : tokenExpiresAt,
    status: registrationError ? 'disconnected' : 'connected',
    connected_at: registrationError ? null : new Date().toISOString(),
    registered_at: registrationError ? null : registeredAt,
    subscribed_apps_at: subscribedAppsAt,
    last_registration_error: registrationError,
    updated_at: new Date().toISOString(),
  };

  const write = existing
    ? supabase.from('whatsapp_config').update(row).eq('account_id', accountId)
    : supabase.from('whatsapp_config').insert({
        account_id: accountId,
        user_id: userId,
        ...row,
      });
  const { error: writeError } = await write;

  if (writeError) {
    console.error('[whatsapp/configure] configuration persistence failed');
    configurationFailure(
      existing
        ? 'Failed to update configuration'
        : 'Failed to save configuration'
    );
  }

  return {
    saved: true,
    phoneInfo,
    registered: registeredAt != null && registrationError === null,
    registrationSkipped,
    registrationError,
  };
}
