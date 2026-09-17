import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyZernioWebhookSignature } from './webhook-signature';

describe('verifyZernioWebhookSignature', () => {
  it('accepts the raw body signed with the configured secret', () => {
    const body = '{"id":"event-1"}';
    const signature = crypto
      .createHmac('sha256', 'zernio-secret')
      .update(body)
      .digest('hex');

    expect(verifyZernioWebhookSignature(body, signature, 'zernio-secret')).toBe(
      true
    );
  });

  it('rejects a missing, malformed, or tampered signature', () => {
    const body = '{}';
    expect(verifyZernioWebhookSignature(body, null, 'zernio-secret')).toBe(
      false
    );
    expect(
      verifyZernioWebhookSignature(body, 'sha256=wrong', 'zernio-secret')
    ).toBe(false);
    expect(
      verifyZernioWebhookSignature('{"changed":true}', 'wrong', 'zernio-secret')
    ).toBe(false);
  });
});
