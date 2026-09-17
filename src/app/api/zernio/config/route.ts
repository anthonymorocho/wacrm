import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/meta/admin-client';
import {
  ensureZernioProfile,
  hasZernioCredentials,
  saveZernioCredentials,
} from '@/lib/zernio/profile';

const MAX_CREDENTIAL_LENGTH = 2048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCredential(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);

  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  if (normalized.length > MAX_CREDENTIAL_LENGTH) {
    throw new Error(
      `${field} must be at most ${MAX_CREDENTIAL_LENGTH} characters`
    );
  }
  return normalized;
}

function parseCredentials(input: unknown): {
  apiKey: string;
  webhookSecret: string;
} {
  if (!isRecord(input)) throw new Error('Configuration must be an object');
  return {
    apiKey: readCredential(input, 'api_key'),
    webhookSecret: readCredential(input, 'webhook_secret'),
  };
}

/** GET /api/zernio/config — return status only, never credential values. */
export async function GET() {
  try {
    const { accountId } = await requireRole('viewer');
    return NextResponse.json({
      configured: await hasZernioCredentials(supabaseAdmin(), accountId),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** POST /api/zernio/config — save the current account's private credentials. */
export async function POST(request: Request) {
  try {
    const context = await requireRole('admin');

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    let credentials: { apiKey: string; webhookSecret: string };
    try {
      credentials = parseCredentials(body);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : 'Invalid configuration',
        },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();
    // The API key is needed to create the account's Zernio profile the first
    // time. Existing profiles are reused without making a second profile.
    await ensureZernioProfile(admin, {
      accountId: context.accountId,
      userId: context.userId,
      accountName: context.account.name,
      apiKey: credentials.apiKey,
    });
    await saveZernioCredentials(admin, {
      accountId: context.accountId,
      apiKey: credentials.apiKey,
      webhookSecret: credentials.webhookSecret,
    });

    // Deliberately do not return either credential, encrypted or plaintext.
    return NextResponse.json({ configured: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
