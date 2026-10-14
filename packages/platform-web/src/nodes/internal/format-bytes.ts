// A byte count in binary units (`512 B`, `1.5 KB`, `3.2 GB`) for the worker
// vitals (issue #854). The same formatter as the telemetry slice's
// `formatBytes` (`telemetry/headless/lib/format.ts`), copied rather than
// imported because a slice may import only the slices
// `packages/platform-slices.json` lists for it. Slice-private, not exported.

const compact = (n: number, digits = 1) => n.toLocaleString(undefined, { maximumFractionDigits: digits });

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (Math.abs(value) >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${compact(value, unit === 0 ? 0 : 1)} ${units[unit]}`;
}
