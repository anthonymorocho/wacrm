export interface ResponseTimeLabels {
  second: string;
  minute: string;
  hour: string;
  separator: string;
  empty: string;
}

/** Format an average response duration expressed in minutes. */
export function formatResponseTime(
  minutes: number | null,
  labels: ResponseTimeLabels
): string {
  if (minutes == null || !Number.isFinite(minutes)) return labels.empty;

  const totalSeconds = Math.max(0, Math.round(minutes * 60));
  const unit = (value: number, label: string) =>
    `${value}${labels.separator}${label}`;

  if (totalSeconds < 60) return unit(totalSeconds, labels.second);

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds > 0
      ? `${unit(totalMinutes, labels.minute)} ${unit(seconds, labels.second)}`
      : unit(totalMinutes, labels.minute);
  }

  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  return remainingMinutes > 0
    ? `${unit(hours, labels.hour)} ${unit(remainingMinutes, labels.minute)}`
    : unit(hours, labels.hour);
}
