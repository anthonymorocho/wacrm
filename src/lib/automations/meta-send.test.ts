import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentRows: Array<Record<string, unknown>> = [];
const template = {
  id: 'template-1',
  user_id: 'user-1',
  name: 'hello_customer',
  category: 'Utility' as const,
  language: 'es',
  body_text: 'Hola {{1}}, gracias por escribirnos.',
  created_at: '2026-01-01T00:00:00Z',
};

const { sendTemplateMessage } = vi.hoisted(() => ({
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid-1' })),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage,
  sendTextMessage: vi.fn(),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'token'),
}));
vi.mock('./admin-client', () => ({
  supabaseAdmin: vi.fn(),
}));

import { supabaseAdmin } from './admin-client';
import { engineSendTemplate } from './meta-send';

function makeDb() {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    const chain = () => b;

    for (const method of ['select', 'eq', 'update', 'order']) {
      b[method] = vi.fn(chain);
    }
    b.maybeSingle = vi.fn(async () => {
      if (table === 'contacts') {
        return {
          data: { id: 'contact-1', phone: '+15551234567' },
          error: null,
        };
      }
      if (table === 'message_templates') {
        return { data: template, error: null };
      }
      return { data: null, error: null };
    });
    b.single = vi.fn(async () => ({
      data: {
        phone_number_id: 'phone-number-1',
        access_token: 'encrypted-token',
      },
      error: null,
    }));
    b.insert = vi.fn((row: Record<string, unknown>) => {
      sentRows.push(row);
      return b;
    });
    b.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve);
    return b;
  }

  return { from: vi.fn((table: string) => builder(table)) };
}

describe('engineSendTemplate', () => {
  beforeEach(() => {
    sentRows.length = 0;
    sendTemplateMessage.mockClear();
    vi.mocked(supabaseAdmin).mockReturnValue(makeDb() as never);
  });

  it('persists the rendered template body in the inbox message', async () => {
    await engineSendTemplate({
      accountId: 'account-1',
      userId: 'user-1',
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      templateName: template.name,
      language: template.language,
      params: ['Ana'],
    });

    expect(sentRows).toContainEqual(
      expect.objectContaining({
        content_type: 'template',
        template_name: template.name,
        content_text: 'Hola Ana, gracias por escribirnos.',
      })
    );
  });
});
