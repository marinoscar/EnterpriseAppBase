const LOCAL_DIR_RE = /^(\d{14})_/;

/**
 * Formats an instant as the 14-digit UTC timestamp Prisma puts in a
 * migration directory name (`YYYYMMDDHHMMSS`).
 *
 * @param ms - Milliseconds since the epoch.
 * @returns For example `20261006100000`.
 * @stability experimental
 */
export function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/**
 * Parses a 14-digit UTC migration timestamp.
 *
 * @param stamp - `YYYYMMDDHHMMSS`.
 * @returns Milliseconds since the epoch.
 * @stability experimental
 */
export function parseTimestamp(stamp: string): number {
  return Date.UTC(
    Number(stamp.slice(0, 4)),
    Number(stamp.slice(4, 6)) - 1,
    Number(stamp.slice(6, 8)),
    Number(stamp.slice(8, 10)),
    Number(stamp.slice(10, 12)),
    Number(stamp.slice(12, 14)),
  );
}

/**
 * The greatest 14-digit timestamp among the timestamped directories of an
 * app's migration history, installed or app-authored (`migration_lock.toml`
 * and other non-timestamped names are ignored).
 *
 * @param localDirs - Every directory name under `prisma/migrations`.
 * @returns Milliseconds since the epoch, or `undefined` when there is none.
 * @stability experimental
 */
export function latestLocalTimestamp(localDirs: readonly string[]): number | undefined {
  let latest: number | undefined;
  for (const dir of localDirs) {
    const match = LOCAL_DIR_RE.exec(dir);
    if (!match) continue;
    const ms = parseTimestamp(match[1]!);
    if (latest === undefined || ms > latest) latest = ms;
  }
  return latest;
}

/**
 * The naming rule. `base = max(now (whole seconds), latest + 1 second)`; the
 * i-th migration installed by one run gets `base + i seconds`. An installed
 * migration therefore always sorts after everything already in the history
 * and after its predecessors, even under clock skew.
 *
 * @param localDirs - Every directory name already in the app's history.
 * @param count - How many migrations this run installs.
 * @param now - The clock (injectable for tests, and the `--timestamp` override).
 * @returns `count` strictly ascending 14-digit timestamps.
 * @stability experimental
 */
export function nextTimestamps(localDirs: readonly string[], count: number, now: Date): string[] {
  const latest = latestLocalTimestamp(localDirs);
  const nowSeconds = Math.floor(now.getTime() / 1000) * 1000;
  const base = latest === undefined ? nowSeconds : Math.max(nowSeconds, latest + 1000);
  return Array.from({ length: count }, (_, i) => formatTimestamp(base + i * 1000));
}
