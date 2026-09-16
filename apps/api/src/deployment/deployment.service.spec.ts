import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEPLOY_STATE_CACHE_MS,
  DEPLOY_STATE_FILE_ENV,
  DeploymentService,
  MAX_DEPLOY_STATE_BYTES,
} from './deployment.service';

// =============================================================================
// DeploymentService — tests (issue #392, epic #388)
// =============================================================================
//
// The point of this endpoint is that it NEVER FAILS, so the interesting cases
// are all the ways the file can be wrong. Six of them are named in the issue
// and each has a test below: valid v2, valid v1, absent file, unset variable,
// malformed JSON, schema-invalid content — plus the two the runtime can produce
// on its own (a directory where a file was expected, which is what a Docker
// bind mount creates for a path that does not exist yet, and an oversized file).
//
// Real files in a real temporary directory rather than a mocked `node:fs`: the
// behaviour under test IS the filesystem's — ENOENT versus EISDIR versus a
// successful read of nonsense — and a mock would only assert that the mock was
// written to match the implementation.
// =============================================================================

const V2_STATE = {
  version: 2,
  repoUrl: 'https://github.com/owner/repo',
  ref: 'main',
  commitSha: 'b9deed9aa1c4e7d0f2b3a5c6d7e8f90123456789',
  previousSha: '0706bcb1234567890abcdef1234567890abcdef1',
  domain: 'app.example.com',
  bindPort: 3535,
  deployRoot: '/opt/infra/apps',
  installedAt: '2026-09-16T12:00:00.000Z',
  lastDeployedAt: '2026-09-16T12:30:00.000Z',
  lastCommand: 'update',
  appctlVersion: '0.1.0',
  completedSteps: ['preflight', 'checkout'],
  host: {
    hostname: 'vps-1',
    os: 'Ubuntu 24.04.1 LTS',
    kernel: '6.8.0-45-generic',
    arch: 'x64',
    cpus: 4,
    memoryBytes: 8_323_264_512,
    dockerVersion: '27.3.1',
    composeVersion: 'v2.29.7',
    publicIp: '203.0.113.10',
  },
  proxy: {
    domain: 'app.example.com',
    bindPort: 3535,
    container: 'proxy-nginx',
    mode: 'container',
    certNotAfter: '2026-12-15T00:00:00.000Z',
  },
  history: [
    {
      at: '2026-09-16T12:30:00.000Z',
      command: 'update',
      commitSha: 'b9deed9aa1c4e7d0f2b3a5c6d7e8f90123456789',
      previousSha: '0706bcb1234567890abcdef1234567890abcdef1',
      ref: 'main',
      durationMs: 184_000,
      appctlVersion: '0.1.0',
      outcome: 'success',
    },
  ],
};

/** A v1 record: the same identity fields, and none of the v2 sections. */
const V1_STATE = {
  version: 1,
  repoUrl: 'https://github.com/owner/repo',
  ref: 'main',
  commitSha: 'b9deed9aa1c4e7d0f2b3a5c6d7e8f90123456789',
  bindPort: 3535,
  deployRoot: '/opt/infra/apps',
  installedAt: '2026-09-16T12:00:00.000Z',
  lastDeployedAt: '2026-09-16T12:00:00.000Z',
  lastCommand: 'install',
  appctlVersion: '0.1.0',
};

describe('DeploymentService', () => {
  let dir: string;
  let statePath: string;
  let service: DeploymentService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'deploy-state-'));
    statePath = join(dir, '.appctl-deploy.json');
    process.env[DEPLOY_STATE_FILE_ENV] = statePath;
    service = new DeploymentService();
    // The service warns on every failure path on purpose; silence it so a
    // passing suite is not full of red herrings.
    warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env[DEPLOY_STATE_FILE_ENV];
    rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function writeState(value: unknown): void {
    writeFileSync(statePath, JSON.stringify(value), 'utf8');
  }

  // ---------------------------------------------------------------------------
  // The happy paths
  // ---------------------------------------------------------------------------

  it('serves a valid v2 record in full', async () => {
    writeState(V2_STATE);

    const result = await service.describe();

    expect(result.configured).toBe(true);
    expect(result.source).toEqual({ path: statePath, reason: null });
    expect(result.deployment).toEqual(V2_STATE);
  });

  it('serves a valid v1 record with the v2 sections simply absent', async () => {
    writeState(V1_STATE);

    const result = await service.describe();

    expect(result.configured).toBe(true);
    expect(result.source.reason).toBeNull();
    expect(result.deployment).toEqual(V1_STATE);
    // Not null, not empty objects — ABSENT. A client renders "this deployment
    // predates host capture", which is different from "the host is unknown".
    expect(result.deployment).not.toHaveProperty('host');
    expect(result.deployment).not.toHaveProperty('proxy');
    expect(result.deployment).not.toHaveProperty('history');
  });

  it('parses a HOST-MODE proxy, which has no container to name', async () => {
    // ⚠ THE REGRESSION THIS TEST EXISTS FOR. `appctl` omits `proxy.container`
    // when the proxy is nginx running as a system service rather than in a
    // container — there is no container, so it writes no name rather than an
    // empty string. A required `container` would fail the parse, and this
    // service turns a failed parse into `configured: false, reason: 'invalid'`:
    // a healthy host-mode deployment would render as "not configured", with a
    // reason that is a lie about its own state file.
    const { container: _container, certNotAfter: _certNotAfter, ...rest } = V2_STATE.proxy;
    const hostMode = { ...V2_STATE, proxy: { ...rest, mode: 'host' } };
    writeState(hostMode);

    const result = await service.describe();

    expect(result.configured).toBe(true);
    expect(result.source.reason).toBeNull();
    expect(result.deployment).toEqual(hostMode);
  });

  it('parses the shapes a FIRST INSTALL and a NAT-ed host actually produce', async () => {
    // Three absences the writer genuinely emits, all on one file because they
    // co-occur: no `previousSha` anywhere (nothing preceded this install), and
    // no `host.publicIp` (resolved from the local routing table only, and
    // omitted rather than recorded as a LAN address).
    const {
      previousSha: _previousSha,
      ...state
    } = V2_STATE;
    const { publicIp: _publicIp, ...host } = V2_STATE.host;
    const { previousSha: _entryPrevious, ...entry } = V2_STATE.history[0];

    const firstInstall = {
      ...state,
      lastCommand: 'install',
      host,
      history: [{ ...entry, command: 'install' }],
    };
    writeState(firstInstall);

    const result = await service.describe();

    expect(result.configured).toBe(true);
    expect(result.deployment).toEqual(firstInstall);
  });

  it('still requires the three host fields that are always written', async () => {
    // `os`, `dockerVersion` and `composeVersion` carry the literal "unknown"
    // when their probe fails, so the SHAPE never varies with how much of the
    // machine was readable — which is why they are not optional, and why a
    // file missing one is a genuinely malformed record rather than a partial
    // one.
    const { dockerVersion: _dockerVersion, ...host } = V2_STATE.host;
    writeState({ ...V2_STATE, host });

    const result = await service.describe();

    expect(result.source.reason).toBe('invalid');
  });

  it('strips unknown keys rather than echoing an untrusted file back', async () => {
    // The file is host-controlled. Anything this endpoint does not understand
    // must not reach a client, whatever a future writer decides to add.
    writeState({ ...V2_STATE, injected: '<script>', host: { ...V2_STATE.host, extra: 'x' } });

    const result = await service.describe();

    expect(result.configured).toBe(true);
    expect(result.deployment).not.toHaveProperty('injected');
    expect(result.deployment).toEqual(V2_STATE);
  });

  it('drops a v1 file that carries v2 sections, rather than serving them', async () => {
    // v1 made no promise about what `host` means, so a v1 writer using that key
    // for something else must not be rendered as a v2 host record.
    writeState({ ...V1_STATE, host: V2_STATE.host });

    const result = await service.describe();

    expect(result.configured).toBe(true);
    expect(result.deployment).not.toHaveProperty('host');
  });

  // ---------------------------------------------------------------------------
  // The absent cases — both are NORMAL, and they are told apart
  // ---------------------------------------------------------------------------

  it('reports not-found, with the path it looked at, when the file is absent', async () => {
    const result = await service.describe();

    expect(result.configured).toBe(false);
    expect(result.deployment).toBeNull();
    expect(result.source).toEqual({ path: statePath, reason: 'not-found' });
  });

  it('reports not-found with a NULL path when DEPLOY_STATE_FILE is unset', async () => {
    // No default path is guessed: a dev machine must not stat `/opt/...` on
    // every request. A null path is how a client tells "not an appctl
    // deployment" from "an appctl deployment whose file went missing".
    delete process.env[DEPLOY_STATE_FILE_ENV];

    const result = await service.describe();

    expect(result.configured).toBe(false);
    expect(result.source).toEqual({ path: null, reason: 'not-found' });
  });

  it('treats an empty DEPLOY_STATE_FILE the same as an unset one', async () => {
    // Compose interpolates an unset variable to the empty string, so this is
    // the shape a misconfigured overlay actually produces.
    process.env[DEPLOY_STATE_FILE_ENV] = '   ';

    const result = await service.describe();

    expect(result.source).toEqual({ path: null, reason: 'not-found' });
  });

  // ---------------------------------------------------------------------------
  // The broken cases — none of them may throw
  // ---------------------------------------------------------------------------

  it('reports invalid for malformed JSON', async () => {
    writeFileSync(statePath, '{"version": 2, "repoUrl":', 'utf8');

    const result = await service.describe();

    expect(result.configured).toBe(false);
    expect(result.deployment).toBeNull();
    expect(result.source).toEqual({ path: statePath, reason: 'invalid' });
  });

  it('never puts the file contents in the log when JSON parsing fails', async () => {
    // `JSON.parse` embeds the offending input in its message. This file is not
    // ours to copy into a log aggregator.
    writeFileSync(statePath, '{"secret-ish": "n0tf0rthel0g"', 'utf8');

    await service.describe();

    expect(warn).toHaveBeenCalled();
    for (const call of warn.mock.calls) {
      expect(String(call[0])).not.toContain('n0tf0rthel0g');
    }
  });

  it('reports invalid for schema-invalid content', async () => {
    // Right shape, wrong types: a string port and a non-ISO timestamp.
    writeState({ ...V2_STATE, bindPort: '3535', lastDeployedAt: 'yesterday' });

    const result = await service.describe();

    expect(result.configured).toBe(false);
    expect(result.source).toEqual({ path: statePath, reason: 'invalid' });
  });

  it('reports invalid for an unknown state version rather than guessing', async () => {
    // Refused, not read as the nearest version it resembles: misreading a state
    // file means reporting the wrong commit as deployed.
    writeState({ ...V2_STATE, version: 3 });

    const result = await service.describe();

    expect(result.source.reason).toBe('invalid');
  });

  it('reports unreadable when the path is a directory', async () => {
    // Exactly what Docker creates for a single-FILE bind mount whose host path
    // does not exist yet — the failure `infra/compose/vps.compose.yml` mounts
    // the deploy root to avoid.
    rmSync(statePath, { force: true });
    mkdirSync(statePath);

    const result = await service.describe();

    expect(result.configured).toBe(false);
    expect(result.source).toEqual({ path: statePath, reason: 'unreadable' });
  });

  it('reports invalid for a file too large to be a deployment record', async () => {
    writeFileSync(statePath, 'x'.repeat(MAX_DEPLOY_STATE_BYTES + 1), 'utf8');

    const result = await service.describe();

    expect(result.source).toEqual({ path: statePath, reason: 'invalid' });
  });

  it('truncates an over-long history instead of refusing the file', async () => {
    const entry = V2_STATE.history[0];
    writeState({ ...V2_STATE, history: Array.from({ length: 50 }, () => entry) });

    const result = await service.describe();

    expect(result.configured).toBe(true);
    expect(
      (result.deployment as { history?: unknown[] }).history,
    ).toHaveLength(20);
  });

  // ---------------------------------------------------------------------------
  // Runtime facts, which survive every failure above
  // ---------------------------------------------------------------------------

  it('always reports runtime facts, including when nothing is configured', async () => {
    const result = await service.describe();

    expect(result.configured).toBe(false);
    expect(result.runtime.apiVersion).toEqual(expect.any(String));
    expect(result.runtime.nodeVersion).toBe(process.version);
    expect(result.runtime.hostname).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(result.runtime.startedAt))).toBe(false);
  });

  it('reports a startedAt that does not move between calls', async () => {
    // Reconstructed from `process.uptime()`, so recomputing it per request
    // would jitter and make a polling client re-render every few seconds.
    const first = await service.describe();
    const second = await service.describe();

    expect(second.runtime.startedAt).toBe(first.runtime.startedAt);
  });

  it('defaults nodeEnv to development when NODE_ENV is unset', async () => {
    const previous = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      const result = await service.describe();
      expect(result.runtime.nodeEnv).toBe('development');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  // ---------------------------------------------------------------------------
  // The cache
  // ---------------------------------------------------------------------------

  it('serves a cached read, then picks up a redeploy once the window passes', async () => {
    jest.useFakeTimers();
    writeState(V1_STATE);

    const first = await service.describe();
    expect(first.deployment).toMatchObject({ commitSha: V1_STATE.commitSha });

    writeState({ ...V1_STATE, commitSha: 'c'.repeat(40), lastCommand: 'update' });

    // Inside the window: still the old answer, which is the price of caching.
    const cached = await service.describe();
    expect(cached.deployment).toMatchObject({ commitSha: V1_STATE.commitSha });

    jest.advanceTimersByTime(DEPLOY_STATE_CACHE_MS + 1);

    const refreshed = await service.describe();
    expect(refreshed.deployment).toMatchObject({ commitSha: 'c'.repeat(40) });
  });

  it('caches a failure too, and invalidateCache clears it', async () => {
    jest.useFakeTimers();

    const missing = await service.describe();
    expect(missing.source.reason).toBe('not-found');

    writeState(V1_STATE);

    // A missing file is the common case; re-reading it on every poll is the
    // traffic the cache exists to avoid, so the failure is cached as well.
    expect((await service.describe()).configured).toBe(false);

    service.invalidateCache();

    expect((await service.describe()).configured).toBe(true);
  });
});
