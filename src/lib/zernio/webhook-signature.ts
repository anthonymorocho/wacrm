import crypto from 'node:crypto';

/** Verify Zernio's lowercase-hex HMAC-SHA256 signature over the raw body. */
export function verifyZernioWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!secret.trim() || !signatureHeader) return false;

  const signature = signatureHeader.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  const actualBytes = Buffer.from(signature, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  return crypto.timingSafeEqual(actualBytes, expectedBytes);
}
