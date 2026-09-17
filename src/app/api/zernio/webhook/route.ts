import { NextResponse, after } from 'next/server';

import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { supabaseAdmin } from '@/lib/meta/admin-client';
import { processZernioEvent } from '@/lib/zernio/inbound';
import { listZernioWebhookSecrets } from '@/lib/zernio/profile';
import { verifyZernioWebhookSignature } from '@/lib/zernio/webhook-signature';

export const maxDuration = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHandledEvent(
  value: unknown
): value is 'message.received' | 'account.disconnected' {
  return value === 'message.received' || value === 'account.disconnected';
}

/** POST /api/zernio/webhook — signed, at-least-once Zernio deliveries. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature =
    request.headers.get('x-zernio-signature') ??
    request.headers.get('x-late-signature');

  const db = supabaseAdmin();
  let webhookSecrets;
  try {
    webhookSecrets = await listZernioWebhookSecrets(db);
  } catch (error) {
    console.error('[zernio/webhook] credential lookup failed:', error);
    return NextResponse.json(
      { error: 'Unable to validate webhook' },
      { status: 500 }
    );
  }

  // The body contains the profile id, but it must not be parsed until at
  // least one account-owned secret has authenticated the raw payload.
  const anyValidSignature = webhookSecrets.some(({ webhookSecret }) =>
    verifyZernioWebhookSignature(rawBody, signature, webhookSecret)
  );
  if (!anyValidSignature) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!isRecord(payload)) {
    return NextResponse.json({ error: 'Missing event id' }, { status: 400 });
  }

  // Accept a signature only from the profile named in the payload. Without
  // this second check, any configured tenant could sign a forged event for a
  // different tenant because the endpoint must try multiple secrets.
  const payloadAccount = isRecord(payload.account) ? payload.account : null;
  const payloadProfileId =
    typeof payloadAccount?.profileId === 'string'
      ? payloadAccount.profileId.trim()
      : '';
  if (
    !payloadProfileId ||
    !webhookSecrets.some(
      ({ profileId, webhookSecret }) =>
        profileId === payloadProfileId &&
        verifyZernioWebhookSignature(rawBody, signature, webhookSecret)
    )
  ) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  if (typeof payload.id !== 'string' || !payload.id.trim()) {
    return NextResponse.json({ error: 'Missing event id' }, { status: 400 });
  }

  const headerEventId = request.headers.get('x-zernio-event-id');
  if (headerEventId && headerEventId !== payload.id) {
    return NextResponse.json({ error: 'Event id mismatch' }, { status: 400 });
  }

  // The endpoint is intentionally tolerant of test and future event types;
  // only the subscribed events are persisted and processed by this CRM.
  if (!isHandledEvent(payload.event)) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  const { error } = await db.from('zernio_webhook_events').insert({
    id: payload.id,
    event: payload.event,
    payload,
  });
  if (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ status: 'received' }, { status: 200 });
    }
    console.error('[zernio/webhook] event persistence failed:', error);
    return NextResponse.json(
      { error: 'Unable to persist webhook event' },
      { status: 500 }
    );
  }

  after(async () => {
    const eventId = payload.id as string;
    try {
      const result = await processZernioEvent(payload);
      if (result === 'failed') {
        throw new Error('Zernio message processing failed');
      }
      const { error: updateError } = await db
        .from('zernio_webhook_events')
        .update({
          processed_at: new Date().toISOString(),
          processing_error: null,
        })
        .eq('id', eventId);
      if (updateError) throw updateError;
    } catch (processingError) {
      console.error(
        '[zernio/webhook] event processing failed:',
        processingError
      );
      await db
        .from('zernio_webhook_events')
        .update({
          processing_error:
            processingError instanceof Error
              ? processingError.message.slice(0, 500)
              : 'Unknown processing error',
        })
        .eq('id', eventId);
    }
  });

  return NextResponse.json({ status: 'received' }, { status: 200 });
}
