import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('MessageThread layout', () => {
  it('allows the thread root to shrink so the messages area can scroll', () => {
    const source = readFileSync(
      new URL('./message-thread.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toMatch(
      /className=\{cn\(\s*['"]flex min-h-0 min-w-0 flex-1 flex-col/
    );
  });
});
