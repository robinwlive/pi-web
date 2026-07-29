export function formatMillisecondsTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function formatResponseDuration(durationMs: number): string {
  const milliseconds = Math.max(0, durationMs);
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(3)}s`;

  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = ((milliseconds % 60_000) / 1000).toFixed(3).padStart(6, "0");
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, "0")}m ${seconds}s`
    : `${minutes}m ${seconds}s`;
}

export function formatResponseTimeline(responseStartedAt: number, responseEndedAt: number): string {
  return `${formatMillisecondsTime(responseStartedAt)} → ${formatMillisecondsTime(responseEndedAt)}`;
}

export function formatTokensPerSecond(tokens: number, durationMs: number): string | null {
  if (tokens <= 0 || durationMs <= 0) return null;
  return `${(tokens / (durationMs / 1000)).toFixed(1)} t/s`;
}

export function formatLatencyStats(samples: number[]): string | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  const parts = [
    `avg ${formatResponseDuration(average)}`,
    `P50 ${formatResponseDuration(percentile(0.5))}`,
  ];
  if (samples.length >= 20) parts.push(`P95 ${formatResponseDuration(percentile(0.95))}`);
  parts.push(`min ${formatResponseDuration(sorted[0])}`, `max ${formatResponseDuration(sorted[sorted.length - 1])}`);
  return parts.join(" · ");
}
