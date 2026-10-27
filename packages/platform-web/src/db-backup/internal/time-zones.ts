// The zone ids the backup schedule's picker offers: the runtime's own ICU list
// (`Intl.supportedValuesOf('timeZone')`), with `UTC` first. Not a hand-kept
// list, so it cannot rot, and the field stays free text (`freeSolo`) so a zone
// the browser does not list but the server can schedule against is still
// accepted; the API remains the validator. Kept here rather than imported from
// the timezone slice, which `db-backup` may not depend on
// (packages/platform-slices.json) and whose catalog carries the map data.

let cached: readonly string[] | null = null;

/** Every IANA zone this runtime knows, `UTC` first; `['UTC']` on an engine without the API. */
export function backupTimeZoneOptions(): readonly string[] {
  if (cached) return cached;
  let zones: string[] = [];
  try {
    const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    zones = supported ? supported('timeZone') : [];
  } catch {
    zones = [];
  }
  cached = ['UTC', ...zones.filter((zone) => zone !== 'UTC')];
  return cached;
}
