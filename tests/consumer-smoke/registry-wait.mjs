// Waits until every platform package resolves from the npm registry (issue #697
// follow-up). Right after `changeset publish` the registry and its CDN can
// still answer 404, or an older packument, for a version that was just
// published; installing then fails. `run.mjs --from registry` calls this
// before the first install. Pure apart from the injected `view`, `sleep` and
// `now`, so the tests drive it without a network.
// Node built-ins only.

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** True when `spec` names one exact version (not a dist-tag or a range). */
export function isExactVersion(spec) {
  return EXACT_VERSION.test(spec);
}

/**
 * Polls `view(name, spec)` for every package until each resolves, with
 * exponential backoff. `view` returns the resolved version string, or null when
 * the registry does not answer it yet. For an exact version the answer must
 * equal it (a stale packument may answer an older one); for a dist-tag any
 * answer counts. Throws, naming the missing packages, once `timeoutMs` is spent.
 *
 * @returns {Promise<Record<string, string>>} the resolved version per package
 */
export async function waitForRegistry({
  packages,
  spec,
  view,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  timeoutMs = 10 * 60_000,
  initialDelayMs = 5_000,
  maxDelayMs = 60_000,
  log = () => {},
}) {
  const exact = isExactVersion(spec);
  const resolved = {};
  let pending = [...packages];
  const deadline = now() + timeoutMs;
  let delay = initialDelayMs;
  for (let attempt = 1; ; attempt += 1) {
    const still = [];
    for (const name of pending) {
      const version = await view(name, spec);
      if (version && (!exact || version === spec)) resolved[name] = version;
      else still.push({ name, seen: version });
    }
    pending = still.map((p) => p.name);
    if (pending.length === 0) {
      log(`registry: all ${packages.length} packages resolve ${spec} (attempt ${attempt})`);
      return resolved;
    }
    const missing = still.map((p) => `${p.name}@${spec}${p.seen ? ` (registry answers ${p.seen})` : ''}`).join(', ');
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error(
        `the registry did not serve ${missing} within ${Math.round(timeoutMs / 1000)} s of polling; ` +
          'check the publish job and npmjs.com, then re-run',
      );
    }
    const wait = Math.min(delay, remaining);
    log(`registry: not yet served: ${missing}; retrying in ${Math.round(wait / 1000)} s (attempt ${attempt})`);
    await sleep(wait);
    delay = Math.min(delay * 2, maxDelayMs);
  }
}
