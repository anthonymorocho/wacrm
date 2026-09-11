import { describe, expect, it } from 'vitest';

import { adjustImageZoom, clampImageZoom } from './image-viewer';

describe('image viewer zoom', () => {
  it('keeps zoom between the supported minimum and maximum', () => {
    expect(clampImageZoom(0.5)).toBe(1);
    expect(clampImageZoom(4)).toBe(3);
    expect(clampImageZoom(2)).toBe(2);
  });

  it('changes zoom in fixed steps', () => {
    expect(adjustImageZoom(1, 1)).toBe(1.25);
    expect(adjustImageZoom(3, 1)).toBe(3);
    expect(adjustImageZoom(1, -1)).toBe(1);
  });
});
