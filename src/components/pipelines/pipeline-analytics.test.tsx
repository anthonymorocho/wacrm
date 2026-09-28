import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Deal } from '@/types';

import { PipelineAnalytics } from './pipeline-analytics';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('PipelineAnalytics', () => {
  it('counts message-created deals as conversations, not won deals', () => {
    const updatedAt = new Date().toISOString();
    const baseDeal = {
      user_id: 'user-1',
      pipeline_id: 'pipeline-1',
      stage_id: 'stage-1',
      contact_id: 'contact-1',
      title: 'Ana',
      value: 0,
      created_at: updatedAt,
      updated_at: updatedAt,
      status: 'won',
    } as const;
    const deals = [
      {
        ...baseDeal,
        id: 'conversation-deal',
        auto_created_from_message: true,
      },
      {
        ...baseDeal,
        id: 'real-deal',
        auto_created_from_message: false,
      },
    ] as Deal[];

    const markup = renderToStaticMarkup(
      createElement(PipelineAnalytics, { deals })
    );
    const text = markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

    expect(text).toContain('totalConversations 1');
    expect(text).toContain('wonThisMonth 1');
    expect(text).toContain('lostThisMonth 0');
  });
});
