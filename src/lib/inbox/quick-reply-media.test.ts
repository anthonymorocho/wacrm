import { describe, expect, it } from 'vitest';

import {
  buildQuickReplyImageCaption,
  buildQuickReplyImageDraft,
  shouldDeleteQuickReplyMedia,
  validateQuickReplyMedia,
} from './quick-reply-media';

describe('quick reply media', () => {
  it('converts an image quick reply into an image draft with its text as caption', () => {
    expect(
      buildQuickReplyImageDraft({
        content_text: 'Mira nuestro catálogo',
        media_url: 'https://storage.example/catalog.png',
        media_path: 'account-a/catalog.png',
        media_filename: 'catalog.png',
      })
    ).toEqual({
      kind: 'image',
      mediaUrl: 'https://storage.example/catalog.png',
      filename: 'catalog.png',
      caption: 'Mira nuestro catálogo',
    });
  });

  it('returns no draft when a quick reply has no image', () => {
    expect(
      buildQuickReplyImageDraft({ content_text: 'Solo texto' })
    ).toBeNull();
  });

  it('combines existing text and the quick reply body into one caption', () => {
    expect(buildQuickReplyImageCaption('Hola', 'Mira el catálogo')).toBe(
      'Hola\nMira el catálogo'
    );
    expect(buildQuickReplyImageCaption('', 'Mira el catálogo')).toBe(
      'Mira el catálogo'
    );
  });

  it('accepts only account-scoped image paths at the API boundary', () => {
    expect(
      validateQuickReplyMedia(
        {
          media_url: 'https://storage.example/catalog.png',
          media_path: 'account-a/catalog.png',
          media_filename: 'catalog.png',
        },
        'a'
      )
    ).toMatchObject({ ok: true });
    expect(
      validateQuickReplyMedia(
        {
          media_url: 'https://storage.example/catalog.png',
          media_path: 'account-other/catalog.png',
        },
        'a'
      )
    ).toEqual({ ok: false, error: 'media_path must belong to this account' });
  });

  it('only deletes media when the stored path is being replaced', () => {
    expect(
      shouldDeleteQuickReplyMedia('account-a/old.png', 'account-a/new.png')
    ).toBe(true);
    expect(
      shouldDeleteQuickReplyMedia('account-a/old.png', 'account-a/old.png')
    ).toBe(false);
    expect(shouldDeleteQuickReplyMedia(undefined, 'account-a/new.png')).toBe(
      false
    );
  });
});
