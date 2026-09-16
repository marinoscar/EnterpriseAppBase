import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXIT, exitCodeFor } from '../errors.js';
import { ENV_METADATA } from './env-metadata.js';
import { secretsFrom } from './install.js';
import { createRedactor } from './journal.js';
import {
  DEPLOY_STATE_VERSION,
  DeployStateError,
  MAX_DEPLOY_HISTORY,
  NotInstalledError,
  appendDeployment,
  deployStatePath,
  readState,
  requireState,
  writeState,
  type DeployState,
  type DeploymentRecord,
} from './state.js';

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'appctl-state-'));
}

function sample(deployRoot: string): DeployState {
  return {
    version: DEPLOY_STATE_VERSION,
    repoUrl: 'https://github.com/example/app',
    ref: 'main',
    commitSha: 'a'.repeat(40),
    domain: 'app.example.test',
    bindPort: 3535,
    deployRoot,
    installedAt: '2026-01-01T00:00:00.000Z',
    lastDeployedAt: '2026-01-02T00:00:00.000Z',
    lastCommand: 'install',
    appctlVersion: '1.0.0',
  };
}

/** A v2 state with every optional member populated. */
function fullSample(deployRoot: string): DeployState {
  return {
    ...sample(deployRoot),
    previousSha: 'b'.repeat(40),
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
      publicIp: '203.0.113.5',
    },
    proxy: {
      domain: 'app.example.test',
      bindPort: 3535,
      container: 'proxy-nginx',
      mode: 'container',
      certNotAfter: '2026-04-01T00:00:00.000Z',
    },
    history: [
      {
        at: '2026-01-02T00:00:00.000Z',
        command: 'update',
        commitSha: 'a'.repeat(40),
        previousSha: 'b'.repeat(40),
        ref: 'main',
        durationMs: 184_000,
        appctlVersion: '1.0.0',
        outcome: 'success',
      },
    ],
  };
}

function record(index: number): DeploymentRecord {
  return {
    at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    command: 'update',
    commitSha: String(index).padStart(40, '0'),
    ref: 'main',
    durationMs: 1_000 * index,
    appctlVersion: '1.0.0',
    outcome: 'success',
  };
}

describe('writeState / readState', () => {
  it('round-trips every field', () => {
    const root = makeRoot();
    const state = sample(root);

    writeState(state);

    expect(readState(root)).toEqual(state);
  });

  it('round-trips a version 2 state with a host, a proxy and a history', () => {
    const root = makeRoot();
    const state = fullSample(root);

    writeState(state);

    // The whole v2 surface, unchanged through JSON and back: this is the shape
    // the API validates, so a field that does not survive a round trip here is
    // a field the deployments page will never see.
    expect(readState(root)).toEqual(state);
  });

  it('writes the file 0600', () => {
    const root = makeRoot();
    writeState(sample(root));

    // Not a secret, but it describes the infrastructure and the repository.
    expect(statSync(deployStatePath(root)).mode & 0o777).toBe(0o600);
  });

  it('overwrites an existing state file and keeps the mode', () => {
    const root = makeRoot();
    writeState(sample(root));
    writeState({ ...sample(root), commitSha: 'b'.repeat(40), lastCommand: 'update' });

    expect(readState(root)?.commitSha).toBe('b'.repeat(40));
    expect(statSync(deployStatePath(root)).mode & 0o777).toBe(0o600);
  });

  it('leaves no temporary file behind', () => {
    const root = makeRoot();
    writeState(sample(root));

    const path = deployStatePath(root);
    expect(() => statSync(`${path}.${process.pid}.tmp`)).toThrow();
  });

  it('returns undefined when nothing is installed', () => {
    expect(readState(makeRoot())).toBeUndefined();
  });

  it('rejects a state file this build does not understand', () => {
    const root = makeRoot();
    writeFileSync(deployStatePath(root), JSON.stringify({ version: 99 }));

    // Misreading it would mean updating the wrong checkout or reporting the
    // wrong commit as deployed, so it refuses rather than guessing. Reading v1
    // FORWARD did not soften this: a version from the future is still refused,
    // because forward is a documented upgrade and backward is a guess.
    expect(() => readState(root)).toThrow(DeployStateError);
    expect(() => readState(root)).toThrow(/state version 99/);
  });

  it('rejects a version that is not a number at all', () => {
    const root = makeRoot();
    writeFileSync(deployStatePath(root), JSON.stringify({ version: 'two' }));

    expect(() => readState(root)).toThrow(DeployStateError);
  });

  it('rejects an unparseable state file with a message that explains it', () => {
    const root = makeRoot();
    writeFileSync(deployStatePath(root), '{ not json');

    expect(() => readState(root)).toThrow(/not valid JSON/);
  });

  it('rejects a state file that is valid JSON but not an object', () => {
    const root = makeRoot();
    writeFileSync(deployStatePath(root), '"a string"');

    expect(() => readState(root)).toThrow(DeployStateError);
  });
});

describe('reading a version 1 file forward', () => {
  function writeV1(root: string, extra: Record<string, unknown> = {}): void {
    writeFileSync(
      deployStatePath(root),
      JSON.stringify({
        version: 1,
        repoUrl: 'https://github.com/example/app',
        ref: 'main',
        commitSha: 'a'.repeat(40),
        domain: 'app.example.test',
        bindPort: 3535,
        deployRoot: root,
        installedAt: '2025-06-01T00:00:00.000Z',
        lastDeployedAt: '2025-12-31T00:00:00.000Z',
        lastCommand: 'update',
        appctlVersion: '0.9.0',
        previousSha: 'b'.repeat(40),
        completedSteps: ['preflight'],
        ...extra,
      }),
    );
  }

  it('accepts it and reports it as version 2', () => {
    // Every server installed before v2 shipped has one of these on disk, and
    // `update` reads it BEFORE it writes one. Refusing it would report a
    // working deployment as corrupt on the first run after an upgrade.
    const root = makeRoot();
    writeV1(root);

    expect(readState(root)?.version).toBe(DEPLOY_STATE_VERSION);
  });

  it('keeps every field version 1 actually had', () => {
    const root = makeRoot();
    writeV1(root);

    expect(readState(root)).toEqual({
      version: 2,
      repoUrl: 'https://github.com/example/app',
      ref: 'main',
      commitSha: 'a'.repeat(40),
      domain: 'app.example.test',
      bindPort: 3535,
      deployRoot: root,
      installedAt: '2025-06-01T00:00:00.000Z',
      lastDeployedAt: '2025-12-31T00:00:00.000Z',
      lastCommand: 'update',
      appctlVersion: '0.9.0',
      previousSha: 'b'.repeat(40),
      completedSteps: ['preflight'],
    });
  });

  it('leaves the three new members ABSENT rather than empty', () => {
    const root = makeRoot();
    writeV1(root);
    const state = readState(root);

    // `history: []` would claim this deployment has no past. The truth is that
    // nothing was keeping one, which is what absent says.
    expect(state).not.toHaveProperty('host');
    expect(state).not.toHaveProperty('proxy');
    expect(state).not.toHaveProperty('history');
  });

  it('drops a host or a history smuggled into a file that claims version 1', () => {
    const root = makeRoot();
    writeV1(root, {
      history: [{ at: 'whenever', command: 'install', outcome: 'success' }],
      host: { hostname: 'invented' },
    });

    // The upgrade copies the fields v1 HAD. A hand-edited file must not be
    // able to hand the API a record v1 could never have produced.
    expect(readState(root)).not.toHaveProperty('history');
    expect(readState(root)).not.toHaveProperty('host');
  });

  it('omits a v1 field that was itself optional and absent', () => {
    const root = makeRoot();
    writeFileSync(
      deployStatePath(root),
      JSON.stringify({
        version: 1,
        repoUrl: 'https://github.com/example/app',
        ref: 'main',
        commitSha: 'a'.repeat(40),
        bindPort: 3535,
        deployRoot: root,
        installedAt: '2025-06-01T00:00:00.000Z',
        lastDeployedAt: '2025-12-31T00:00:00.000Z',
        lastCommand: 'install',
        appctlVersion: '0.9.0',
      }),
    );

    const state = readState(root);
    expect(state).not.toHaveProperty('domain');
    expect(state).not.toHaveProperty('previousSha');
    expect(state).not.toHaveProperty('completedSteps');
  });

  it('survives the round trip: upgraded, written, read back as version 2', () => {
    const root = makeRoot();
    writeV1(root);

    const upgraded = readState(root) as DeployState;
    writeState(upgraded);

    expect(readState(root)).toEqual(upgraded);
  });
});

describe('appendDeployment', () => {
  it('puts the newest entry first', () => {
    const state = appendDeployment(
      appendDeployment(sample('/tmp/x'), record(1)),
      record(2),
    );

    expect(state.history?.map((entry) => entry.commitSha)).toEqual([
      record(2).commitSha,
      record(1).commitSha,
    ]);
  });

  it('starts a history on a state that has none', () => {
    expect(appendDeployment(sample('/tmp/x'), record(1)).history).toHaveLength(1);
  });

  it(`caps the history at ${MAX_DEPLOY_HISTORY}, dropping the oldest`, () => {
    let state = sample('/tmp/x');
    for (let index = 1; index <= MAX_DEPLOY_HISTORY + 5; index += 1) {
      state = appendDeployment(state, record(index));
    }

    // Unbounded growth on a server that deploys daily for years, and the
    // entries nobody will read are exactly the oldest ones.
    expect(state.history).toHaveLength(MAX_DEPLOY_HISTORY);
    expect(state.history?.[0]?.commitSha).toBe(record(MAX_DEPLOY_HISTORY + 5).commitSha);
    expect(state.history?.at(-1)?.commitSha).toBe(record(6).commitSha);
  });

  it('is pure: it mutates neither the state nor the array it was given', () => {
    const original = { ...sample('/tmp/x'), history: [record(1)] };
    const history = original.history;

    appendDeployment(original, record(2));

    expect(original.history).toBe(history);
    expect(original.history).toHaveLength(1);
  });

  it('survives a write and a read with the cap intact', () => {
    const root = makeRoot();
    let state = sample(root);
    for (let index = 1; index <= MAX_DEPLOY_HISTORY + 3; index += 1) {
      state = appendDeployment(state, record(index));
    }
    writeState(state);

    expect(readState(root)?.history).toHaveLength(MAX_DEPLOY_HISTORY);
  });
});

describe('the state file holds no secrets', () => {
  /** Every variable the metadata registry marks secret, with a findable value. */
  function secretEnv(): Map<string, string> {
    return new Map(
      Object.keys(ENV_METADATA).map((key) => [key, `s3cret-value-for-${key}`]),
    );
  }

  it('is not changed at all by the journal redactor', () => {
    const root = makeRoot();
    writeState(fullSample(root));

    const redact = createRedactor(secretsFrom(secretEnv()));
    const written = readFileSync(deployStatePath(root), 'utf8');

    // THE STRUCTURAL ASSERTION. This file is 0600 on disk, but v2 is read by
    // the API and rendered in a browser - so the journal's redactor, seeded
    // with every value the metadata registry calls a secret, must find nothing
    // to redact in it. A future field that carried one would fail here rather
    // than in someone's browser.
    expect(redact(written)).toBe(written);
  });

  it('knows about a real set of secrets, so the assertion above can bite', () => {
    const secrets = secretsFrom(secretEnv());

    // Guards the guard: a redactor seeded with nothing changes nothing, which
    // would make the test above pass for the wrong reason.
    expect(secrets.length).toBeGreaterThan(5);
    expect(secrets.map((entry) => entry.key)).toContain('POSTGRES_PASSWORD');
    expect(secrets.map((entry) => entry.key)).toContain('JWT_SECRET');
  });

  it('contains no secret value literally', () => {
    const root = makeRoot();
    writeState(fullSample(root));

    const written = readFileSync(deployStatePath(root), 'utf8');
    for (const entry of secretsFrom(secretEnv())) {
      expect(written).not.toContain(entry.value);
    }
  });

  it('has exactly the top-level fields version 2 declares', () => {
    const root = makeRoot();
    writeState(fullSample(root));

    const parsed = JSON.parse(readFileSync(deployStatePath(root), 'utf8')) as object;

    // Deliberately exhaustive. Adding a field to `DeployState` must fail this
    // test, so the field gets looked at by someone asking whether it belongs
    // in a document the application serves.
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'appctlVersion',
        'bindPort',
        'commitSha',
        'completedSteps',
        'deployRoot',
        'domain',
        'history',
        'host',
        'installedAt',
        'lastCommand',
        'lastDeployedAt',
        'previousSha',
        'proxy',
        'ref',
        'repoUrl',
        'version',
      ].sort(),
    );
  });
});

describe('requireState', () => {
  it('returns the state when a deployment exists', () => {
    const root = makeRoot();
    writeState(sample(root));

    expect(requireState(root).ref).toBe('main');
  });

  it('names the install command and the path when nothing is there', () => {
    const root = makeRoot();
    const error = (() => {
      try {
        requireState(root);
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(NotInstalledError);
    expect((error as Error).message).toContain('deploy install');
    expect((error as Error).message).toContain(root);
    expect((error as Error).message).toContain('--root');
    // A usage problem, not a broken CLI: the remedy is a different command.
    expect(exitCodeFor(error)).toBe(EXIT.USAGE);
  });
});
