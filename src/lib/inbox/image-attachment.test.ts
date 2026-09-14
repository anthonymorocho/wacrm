import { describe, expect, it } from 'vitest';

import {
  getFileDropEffect,
  getImageFileFromClipboardItems,
  getImageFileFromDroppedFiles,
  isCurrentMediaUpload,
} from './image-attachment';

function clipboardItem(kind: string, type: string, file: File | null) {
  return {
    kind,
    type,
    getAsFile: () => file,
  };
}

describe('getImageFileFromClipboardItems', () => {
  it('returns a pasted image and gives nameless screenshots a png filename', () => {
    const image = new File(['png-bytes'], '', { type: 'image/png' });

    const result = getImageFileFromClipboardItems([
      clipboardItem('string', 'text/plain', null),
      clipboardItem('file', 'image/png', image),
    ]);

    expect(result).not.toBeNull();
    expect(result?.type).toBe('image/png');
    expect(result?.name).toBe('pasted-image.png');
  });

  it('ignores clipboard content that is not a supported image', () => {
    const result = getImageFileFromClipboardItems([
      clipboardItem(
        'file',
        'image/gif',
        new File(['gif'], 'image.gif', { type: 'image/gif' })
      ),
      clipboardItem('string', 'text/plain', null),
    ]);

    expect(result).toBeNull();
  });
});

describe('getImageFileFromDroppedFiles', () => {
  it('returns the first supported image from dropped files', () => {
    const image = new File(['jpeg-bytes'], 'capture.jpg', {
      type: 'image/jpeg',
    });

    const result = getImageFileFromDroppedFiles([
      new File(['text'], 'notes.txt', { type: 'text/plain' }),
      image,
    ]);

    expect(result).toBe(image);
  });
});

describe('getFileDropEffect', () => {
  it('allows supported file drags when the composer can accept them', () => {
    expect(getFileDropEffect(true, false, false)).toBe('copy');
  });

  it('blocks the browser default when file drops are disabled or busy', () => {
    expect(getFileDropEffect(true, true, false)).toBe('none');
    expect(getFileDropEffect(true, false, true)).toBe('none');
  });

  it('does not claim non-file drags', () => {
    expect(getFileDropEffect(false, false, false)).toBeNull();
  });
});

describe('isCurrentMediaUpload', () => {
  it('only accepts the mounted upload generation that is still active', () => {
    expect(isCurrentMediaUpload(4, 4, true)).toBe(true);
    expect(isCurrentMediaUpload(3, 4, true)).toBe(false);
    expect(isCurrentMediaUpload(4, 4, false)).toBe(false);
  });
});
