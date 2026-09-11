import { describe, expect, it } from 'vitest';

import { insertEmojiAtSelection } from './emoji-input';

describe('insertEmojiAtSelection', () => {
  it('inserts an emoji at the cursor and returns its new position', () => {
    expect(insertEmojiAtSelection('Hola mundo', '😊', 5, 5)).toEqual({
      value: 'Hola 😊mundo',
      cursorPosition: 7,
    });
  });

  it('replaces the selected text', () => {
    expect(insertEmojiAtSelection('Hola mundo', '👋', 0, 4)).toEqual({
      value: '👋 mundo',
      cursorPosition: 2,
    });
  });
});
