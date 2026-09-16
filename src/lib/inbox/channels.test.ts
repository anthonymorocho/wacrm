import { describe, expect, it } from 'vitest';

import { getInboxChannelLabelKey, normalizeInboxChannel } from './channels';

describe('normalizeInboxChannel', () => {
  it.each([
    ['whatsapp', 'whatsapp'],
    ['instagram', 'instagram'],
    ['messenger', 'messenger'],
  ])('keeps the supported channel %s', (input, expected) => {
    expect(normalizeInboxChannel(input)).toBe(expected);
  });

  it.each([undefined, null, '', 'facebook', 'unknown'])(
    'falls back to WhatsApp for %s',
    (input) => {
      expect(normalizeInboxChannel(input)).toBe('whatsapp');
    }
  );
});

describe('getInboxChannelLabelKey', () => {
  it('returns the translated key for each supported channel', () => {
    expect(getInboxChannelLabelKey('whatsapp')).toBe('whatsapp');
    expect(getInboxChannelLabelKey('instagram')).toBe('instagram');
    expect(getInboxChannelLabelKey('messenger')).toBe('messenger');
  });

  it('uses WhatsApp for legacy rows without a channel', () => {
    expect(getInboxChannelLabelKey(undefined)).toBe('whatsapp');
  });
});
