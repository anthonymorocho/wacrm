import { describe, expect, it } from 'vitest';

import { formatResponseTime } from './response-time';

const labels = {
  second: 's',
  minute: 'min',
  hour: 'h',
  separator: ' ',
  empty: '—',
};

describe('formatResponseTime', () => {
  it('formats sub-minute values as real seconds', () => {
    expect(formatResponseTime(0, labels)).toBe('0 s');
    expect(formatResponseTime(0.75, labels)).toBe('45 s');
  });

  it('formats values below one hour as minutes and remaining seconds', () => {
    expect(formatResponseTime(1, labels)).toBe('1 min');
    expect(formatResponseTime(1.5, labels)).toBe('1 min 30 s');
    expect(formatResponseTime(59.999, labels)).toBe('1 h');
  });

  it('formats values over one hour as hours and remaining minutes', () => {
    expect(formatResponseTime(60, labels)).toBe('1 h');
    expect(formatResponseTime(68, labels)).toBe('1 h 8 min');
  });

  it('uses the empty label for missing values', () => {
    expect(formatResponseTime(null, labels)).toBe('—');
  });
});
