import { describe, expect, it } from 'vitest';

import { ENV_PREFIX } from '../branding.js';
import { SERVER_URL_ENV_VAR, TOKEN_ENV_VAR } from '../config.js';
import { WORKER_ENV, workerEnvNames } from './worker-env.js';

// =============================================================================
// WORKER_ENV — the map every worker variable is declared in  (issue #272)
// =============================================================================
//
// #278 adds the bidirectional Dockerfile/compose guard to this same area. What
// is asserted here is the map's own invariants: it derives from the branding
// prefix, and its first two entries are the EXISTING variables rather than new
// names for the same values.
// =============================================================================

describe('WORKER_ENV', () => {
  it('reuses the existing server-URL and token variables rather than minting new ones', () => {
    // If these ever drift apart, a machine gets `appctl api` working and
    // `appctl node start` not working, with no way for a user to tell why.
    expect(WORKER_ENV.serverUrl).toBe(SERVER_URL_ENV_VAR);
    expect(WORKER_ENV.token).toBe(TOKEN_ENV_VAR);
  });

  it('derives every variable from the branding prefix', () => {
    for (const [key, value] of Object.entries(WORKER_ENV)) {
      expect(value.startsWith(ENV_PREFIX), `${key} (${value})`).toBe(true);
    }
  });

  it('has no duplicate variable names', () => {
    const values = Object.values(WORKER_ENV);
    expect(new Set(values).size).toBe(values.length);
  });

  it('declares every variable the worker reads, sorted and deduplicated', () => {
    const names = workerEnvNames();
    expect(names).toEqual([...names].sort());
    expect(names).toHaveLength(new Set(names).size);
    expect(names).toContain(WORKER_ENV.stateDir);
  });
});
