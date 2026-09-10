import { describe, expect, it } from 'vitest';

import { parseCapacity } from './routing-settings';

describe('parseCapacity', () => {
  it('accepts positive whole numbers and rejects invalid limits', () => {
    expect(parseCapacity('400')).toBe(400);
    expect(parseCapacity(' 12 ')).toBe(12);
    expect(parseCapacity('0')).toBeNull();
    expect(parseCapacity('-1')).toBeNull();
    expect(parseCapacity('1.5')).toBeNull();
    expect(parseCapacity('abc')).toBeNull();
  });
});
