import { describe, expect, it } from 'vitest';

import {
  getIncomingMessageToneNotes,
  shouldPlayIncomingMessageSound,
} from './incoming-message-sound';

describe('shouldPlayIncomingMessageSound', () => {
  it('notifies for a customer message inserted while the tab is hidden', () => {
    expect(
      shouldPlayIncomingMessageSound({
        eventType: 'INSERT',
        senderType: 'customer',
        visibilityState: 'hidden',
      }),
    ).toBe(true);
  });

  it('does not notify for visible tabs or outbound messages', () => {
    expect(
      shouldPlayIncomingMessageSound({
        eventType: 'INSERT',
        senderType: 'customer',
        visibilityState: 'visible',
      }),
    ).toBe(false);
    expect(
      shouldPlayIncomingMessageSound({
        eventType: 'INSERT',
        senderType: 'agent',
        visibilityState: 'hidden',
      }),
    ).toBe(false);
  });
});

describe('incoming message tone', () => {
  it('uses two ascending notes for a recognizable notification chime', () => {
    const notes = getIncomingMessageToneNotes();

    expect(notes).toHaveLength(2);
    expect(notes[0].frequencyHz).toBeLessThan(notes[1].frequencyHz);
    expect(notes[0].startSeconds).toBe(0);
    expect(notes[1].startSeconds).toBeGreaterThan(notes[0].startSeconds);
    expect(notes[1].durationSeconds).toBeGreaterThan(0.15);
  });
});
