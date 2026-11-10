import type { EdgeConfigFile } from '@marinoscar/platform-cli/deploy';

// =============================================================================
// EXAMPLE, NOT WIRED: an app's own single-file nginx mount (PP-14.22)
// =============================================================================
//
// A single-file bind mount pins an INODE, not a path: `git checkout` replaces a
// tracked file with a new one, and the container keeps reading the old bytes
// until it is recreated. `deploy update` hashes the platform's two files
// (`nginx.conf`, `csp.conf`) in the checkout and in the container, and
// recreates nginx when they differ. An app overlay that bind-mounts one more
// FILE into nginx gets the same bug, unchecked, unless it registers the file:
//
//   edgeConfigFiles: [coachRateLimits]
//
// A DIRECTORY mount (`app.d/`) follows renames and never goes stale, so it
// needs no registration; prefer one of those where you can.
// =============================================================================

/** `infra/nginx/coach-limits.conf`, mounted at `/etc/nginx/coach-limits.conf` by `infra/compose/app.prod.coach.compose.yml`. */
export const coachRateLimits: EdgeConfigFile = {
  checkout: 'infra/nginx/coach-limits.conf',
  container: '/etc/nginx/coach-limits.conf',
};
