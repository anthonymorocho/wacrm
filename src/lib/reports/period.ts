import { localDayKey } from '@/lib/dashboard/date-utils';

export interface ReportDateRange {
  from: string;
  to: string;
}

export function initialReportDateRange(): ReportDateRange {
  const today = new Date();
  return {
    from: localDayKey(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: localDayKey(today),
  };
}

function dateAtLocalMidnight(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) || localDayKey(date) !== value
    ? null
    : date;
}

/** Convert inclusive date fields into a half-open local-time interval. */
export function reportPeriod(from: string, to: string) {
  const start = dateAtLocalMidnight(from);
  const end = dateAtLocalMidnight(to);
  if (!start || !end || start > end) return null;

  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}
