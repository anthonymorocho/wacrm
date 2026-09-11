export interface EmojiInsertion {
  value: string;
  cursorPosition: number;
}

/** Insert an emoji using the textarea's UTF-16 selection positions. */
export function insertEmojiAtSelection(
  value: string,
  emoji: string,
  selectionStart: number,
  selectionEnd: number,
): EmojiInsertion {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const nextValue = `${value.slice(0, start)}${emoji}${value.slice(end)}`;

  return {
    value: nextValue,
    cursorPosition: start + emoji.length,
  };
}
