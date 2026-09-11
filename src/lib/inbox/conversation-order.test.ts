import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/types';
import { updateConversationActivity } from './conversations';

function conversation(
  id: string,
  lastMessageAt: string,
): Conversation {
  return {
    id,
    user_id: 'user-1',
    contact_id: `contact-${id}`,
    status: 'open',
    assigned_agent_id: 'agent-1',
    last_message_at: lastMessageAt,
    last_message_text: `message-${id}`,
    unread_count: 0,
    created_at: lastMessageAt,
    updated_at: lastMessageAt,
  };
}

describe('updateConversationActivity', () => {
  it('moves the conversation with newer activity to the top', () => {
    const conversations = [
      conversation('older', '2026-09-11T10:00:00.000Z'),
      conversation('newer', '2026-09-11T11:00:00.000Z'),
    ];

    const result = updateConversationActivity(
      conversations,
      'older',
      '2026-09-11T12:00:00.000Z',
      { last_message_text: 'new customer message' },
    );

    expect(result.map((item) => item.id)).toEqual(['older', 'newer']);
    expect(result[0]).toMatchObject({
      last_message_at: '2026-09-11T12:00:00.000Z',
      last_message_text: 'new customer message',
    });
  });

  it('ignores stale activity so an older realtime event cannot reorder the inbox', () => {
    const conversations = [
      conversation('newer', '2026-09-11T12:00:00.000Z'),
      conversation('older', '2026-09-11T10:00:00.000Z'),
    ];

    const result = updateConversationActivity(
      conversations,
      'older',
      '2026-09-11T09:00:00.000Z',
      { last_message_text: 'stale message' },
    );

    expect(result).toBe(conversations);
    expect(result[1].last_message_text).toBe('message-older');
  });
});
