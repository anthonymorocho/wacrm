export interface SlaThresholds {
  optimalMinutes: number;
  lowMinutes: number;
}

export const DEFAULT_SLA_THRESHOLDS: SlaThresholds = {
  optimalMinutes: 1,
  lowMinutes: 15,
};

export function validateSlaThresholds(
  thresholds: SlaThresholds
): string | null {
  const values = [thresholds.optimalMinutes, thresholds.lowMinutes];

  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    return 'positive';
  }
  if (thresholds.optimalMinutes >= thresholds.lowMinutes) {
    return 'ordered';
  }
  return null;
}
