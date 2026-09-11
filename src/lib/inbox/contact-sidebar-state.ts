import type { Deal } from '@/types';

/** Toggle one contact tag while preserving the order of the current list. */
export function toggleTagId(tagIds: string[], tagId: string): string[] {
  return tagIds.includes(tagId)
    ? tagIds.filter((id) => id !== tagId)
    : [...tagIds, tagId];
}

/** Apply a pipeline/stage change to exactly one deal in the sidebar. */
export function moveDealToPipeline(
  deals: Deal[],
  dealId: string,
  pipelineId: string,
  stageId: string
): Deal[] {
  return deals.map((deal) =>
    deal.id === dealId
      ? { ...deal, pipeline_id: pipelineId, stage_id: stageId }
      : deal
  );
}
