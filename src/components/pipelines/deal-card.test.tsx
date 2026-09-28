import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Deal, PipelineStage } from '@/types';

import { DealCard } from './deal-card';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    key === 'conversationWith' ? `Conversation with ${values?.who}` : key,
}));

describe('DealCard', () => {
  it('shows the latest message on cards created from customer messages', () => {
    const deal = {
      id: 'deal-1',
      user_id: 'user-1',
      pipeline_id: 'pipeline-1',
      stage_id: 'stage-1',
      contact_id: 'contact-1',
      conversation_id: 'conversation-1',
      title: 'Ana',
      value: 0,
      currency: 'USD',
      status: 'open',
      auto_created_from_message: true,
      created_at: '2026-09-28T11:00:00.000Z',
      contact: { id: 'contact-1', name: 'Ana', phone: '123' },
      conversation: { last_message_text: '¿Tienen información de precios?' },
    } as Deal;

    const markup = renderToStaticMarkup(
      createElement(DealCard, {
        deal,
        stage: {
          id: 'stage-1',
          name: 'WhatsApp',
          color: '#22c55e',
        } as PipelineStage,
        onEdit: vi.fn(),
      })
    );

    expect(markup).toContain('Conversation with Ana');
    expect(markup).toContain('¿Tienen información de precios?');
    expect(markup).not.toContain('$0');
  });
});
