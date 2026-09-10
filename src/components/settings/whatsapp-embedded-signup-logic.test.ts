import { describe, expect, it } from 'vitest';
import { parseEmbeddedSignupMessage } from './whatsapp-embedded-signup-logic';

function message(origin: string, data: unknown): MessageEvent<unknown> {
  return { origin, data } as MessageEvent<unknown>;
}

describe('parseEmbeddedSignupMessage', () => {
  it('accepts only Meta finish messages with both selected IDs', () => {
    expect(
      parseEmbeddedSignupMessage(
        message('https://www.facebook.com', {
          type: 'WA_EMBEDDED_SIGNUP',
          event: 'FINISH',
          data: { waba_id: 'waba-1', phone_number_id: 'phone-1' },
        })
      )
    ).toEqual({
      kind: 'finished',
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
    });
  });

  it('rejects messages from another origin or with another type', () => {
    expect(
      parseEmbeddedSignupMessage(
        message('https://evil.example', {
          type: 'WA_EMBEDDED_SIGNUP',
          event: 'FINISH',
          data: { waba_id: 'waba-1', phone_number_id: 'phone-1' },
        })
      )
    ).toBeNull();
    expect(
      parseEmbeddedSignupMessage(
        message('https://www.facebook.com', {
          type: 'OTHER_MESSAGE',
          event: 'FINISH',
          data: { waba_id: 'waba-1', phone_number_id: 'phone-1' },
        })
      )
    ).toBeNull();
  });

  it('accepts Meta cancellation and error events without trusting their text', () => {
    expect(
      parseEmbeddedSignupMessage(
        message('https://www.facebook.com', {
          type: 'WA_EMBEDDED_SIGNUP',
          event: 'CANCEL',
        })
      )
    ).toEqual({ kind: 'cancelled' });
    expect(
      parseEmbeddedSignupMessage(
        message(
          'https://www.facebook.com',
          JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR' })
        )
      )
    ).toEqual({ kind: 'error' });
  });

  it('ignores malformed finish payloads', () => {
    expect(
      parseEmbeddedSignupMessage(
        message('https://www.facebook.com', {
          type: 'WA_EMBEDDED_SIGNUP',
          event: 'FINISH',
          data: { waba_id: 'waba-1' },
        })
      )
    ).toBeNull();
  });
});
