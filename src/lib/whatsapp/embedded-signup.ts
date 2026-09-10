import type { MetaPhoneInfo } from './meta-api';
import { verifyPhoneNumber } from './meta-api';

const META_API_VERSION = 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

/** Maximum size accepted for any browser-supplied Embedded Signup value. */
export const EMBEDDED_SIGNUP_MAX_LENGTH = 2048;

export interface EmbeddedSignupPayload {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  pin: string | null;
  verifyToken: string | null;
}

export interface EmbeddedSignupToken {
  accessToken: string;
  expiresIn: number | null;
  tokenExpiresAt: Date | null;
}

export interface EmbeddedSignupMetaData {
  wabaId: string;
  phoneNumberId: string;
  phoneInfo: MetaPhoneInfo;
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required and must be a string`);
  }

  const normalized = value.trim();
  if (normalized.length > EMBEDDED_SIGNUP_MAX_LENGTH) {
    throw new Error(`${key} exceeds the maximum allowed length`);
  }
  return normalized;
}

function optionalString(
  input: Record<string, unknown>,
  key: string
): string | null {
  const value = input[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`);
  }

  const normalized = value.trim();
  if (normalized.length > EMBEDDED_SIGNUP_MAX_LENGTH) {
    throw new Error(`${key} exceeds the maximum allowed length`);
  }
  return normalized || null;
}

/**
 * Convert the untrusted browser payload into the narrow server contract.
 * Meta's session message is advisory only; the server validates the IDs
 * again with the token returned by the code exchange.
 */
export function validateEmbeddedSignupPayload(
  input: unknown
): EmbeddedSignupPayload {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Embedded Signup payload must be an object');
  }

  const body = input as Record<string, unknown>;
  const code = requiredString(body, 'code');
  const wabaId = requiredString(body, 'waba_id');
  const phoneNumberId = requiredString(body, 'phone_number_id');
  const pin = optionalString(body, 'pin');
  const verifyToken = optionalString(body, 'verify_token');

  if (pin !== null && !/^\d{6}$/.test(pin)) {
    throw new Error('pin must be exactly 6 digits');
  }

  return { code, wabaId, phoneNumberId, pin, verifyToken };
}

function positiveExpiresIn(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

async function readMetaJson(
  response: Response
): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Exchange Meta's short-lived authorization code using credentials that
 * never enter the browser. The App Secret is deliberately not part of any
 * return value or error message.
 */
export async function exchangeEmbeddedSignupCode(args: {
  code: string;
  appId: string;
  appSecret: string;
}): Promise<EmbeddedSignupToken> {
  const params = new URLSearchParams({
    client_id: args.appId,
    client_secret: args.appSecret,
    code: args.code,
  });
  const response = await fetch(
    `${META_API_BASE}/oauth/access_token?${params.toString()}`,
    { method: 'GET' }
  );
  const data = await readMetaJson(response);

  if (!response.ok) {
    throw new Error('Meta rejected the Embedded Signup authorization');
  }

  const accessToken =
    typeof data.access_token === 'string' ? data.access_token.trim() : '';
  if (!accessToken) {
    throw new Error('Meta returned no access token for Embedded Signup');
  }

  const expiresIn = positiveExpiresIn(data.expires_in);
  return {
    accessToken,
    expiresIn,
    tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
  };
}

/**
 * Confirm that the selected phone belongs to the selected WABA, then fetch
 * its metadata. Browser-provided IDs are not trusted until all three calls
 * succeed with the exchanged token.
 */
export async function validateEmbeddedSignupMetaData(args: {
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
}): Promise<EmbeddedSignupMetaData> {
  const wabaResponse = await fetch(
    `${META_API_BASE}/${encodeURIComponent(args.wabaId)}?fields=id`,
    { headers: { Authorization: `Bearer ${args.accessToken}` } }
  );
  const waba = await readMetaJson(wabaResponse);
  if (!wabaResponse.ok || waba.id !== args.wabaId) {
    throw new Error('Meta rejected the selected WhatsApp Business Account');
  }

  const phonesResponse = await fetch(
    `${META_API_BASE}/${encodeURIComponent(args.wabaId)}/phone_numbers?fields=id`,
    { headers: { Authorization: `Bearer ${args.accessToken}` } }
  );
  const phones = await readMetaJson(phonesResponse);
  if (!phonesResponse.ok) {
    throw new Error('Meta rejected the selected WhatsApp phone number');
  }

  const phoneRows = Array.isArray(phones.data) ? phones.data : [];
  const belongsToWaba = phoneRows.some(
    (row) =>
      typeof row === 'object' &&
      row !== null &&
      (row as { id?: unknown }).id === args.phoneNumberId
  );
  if (!belongsToWaba) {
    throw new Error('The phone number does not belong to the selected WABA');
  }

  let phoneInfo: MetaPhoneInfo;
  try {
    phoneInfo = await verifyPhoneNumber({
      phoneNumberId: args.phoneNumberId,
      accessToken: args.accessToken,
    });
  } catch {
    throw new Error('Meta rejected the selected WhatsApp phone number');
  }

  return {
    wabaId: args.wabaId,
    phoneNumberId: args.phoneNumberId,
    phoneInfo,
  };
}
