// A private copy of the jobs slice's `formatDuration` (a slice may import only
// the slices `packages/platform-slices.json` lists for it, and the jobs slice
// has no index). Same rules: the largest unit that still says something
// (`850 ms`, `1.5 s`, `4m 05s`, `2h 03m`, `3d 4h`) and an em dash for `null`.
// Not exported.

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;

  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)} s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${String(remainingMinutes).padStart(2, '0')}m`;

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
