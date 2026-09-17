import { describe, expect, it } from 'vitest';

import type { Deal } from '@/types';
import {
  moveDealToPipeline,
  shouldShowAdditionalPipelineAssignment,
  toggleTagId,
} from './contact-sidebar-state';

const deal = (overrides: Partial<Deal> = {}): Deal => ({
  id: 'deal-1',
  user_id: 'user-1',
  pipeline_id: 'pipeline-old',
  stage_id: 'stage-old',
  contact_id: 'contact-1',
  title: 'Seguimiento',
  value: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('contact sidebar state', () => {
  it('adds and removes a tag id without duplicating it', () => {
    expect(toggleTagId([], 'tag-1')).toEqual(['tag-1']);
    expect(toggleTagId(['tag-1', 'tag-2'], 'tag-1')).toEqual(['tag-2']);
    expect(toggleTagId(['tag-1'], 'tag-1')).toEqual([]);
  });

  it('moves only the selected deal to its new pipeline and stage', () => {
    const deals = [deal(), deal({ id: 'deal-2', pipeline_id: 'pipeline-2' })];

    expect(
      moveDealToPipeline(deals, 'deal-1', 'pipeline-new', 'stage-new')
    ).toEqual([
      deal({ pipeline_id: 'pipeline-new', stage_id: 'stage-new' }),
      deals[1],
    ]);
  });

  it('hides the additional funnel form until it is explicitly opened', () => {
    expect(shouldShowAdditionalPipelineAssignment(1, true, 2, false)).toBe(
      false
    );
    expect(shouldShowAdditionalPipelineAssignment(1, true, 2, true)).toBe(true);
    expect(shouldShowAdditionalPipelineAssignment(1, false, 2, true)).toBe(
      false
    );
  });
});
