// Unit tests for registry-wait.mjs: node --test tests/consumer-smoke/registry-wait.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isExactVersion, waitForRegistry } from './registry-wait.mjs';

const PACKAGES = ['@marinoscar/platform-contract', '@marinoscar/platform-api'];

/** A fake clock: `sleep` advances `now` and records each delay. */
function clock() {
  let t = 0;
  const sleeps = [];
  return { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, sleeps };
}

test('isExactVersion tells a version from a dist-tag or a range', () => {
  assert.equal(isExactVersion('0.1.0-next.21'), true);
  assert.equal(isExactVersion('1.2.3'), true);
  assert.equal(isExactVersion('next'), false);
  assert.equal(isExactVersion('^1.2.3'), false);
});

test('returns at once when every package resolves', async () => {
  const c = clock();
  const result = await waitForRegistry({ packages: PACKAGES, spec: '1.0.0', view: async () => '1.0.0', ...c });
  assert.deepEqual(result, { [PACKAGES[0]]: '1.0.0', [PACKAGES[1]]: '1.0.0' });
  assert.deepEqual(c.sleeps, []);
});

test('backs off until a lagging package appears, and re-asks only the missing ones', async () => {
  const c = clock();
  const calls = [];
  const view = async (name) => {
    calls.push(name);
    if (name === PACKAGES[1] && c.now() < 15_000) return null; // 404 for the first polls
    return '1.0.0';
  };
  await waitForRegistry({ packages: PACKAGES, spec: '1.0.0', view, ...c, initialDelayMs: 5_000 });
  assert.deepEqual(c.sleeps, [5_000, 10_000]);
  assert.deepEqual(calls, [PACKAGES[0], PACKAGES[1], PACKAGES[1], PACKAGES[1]]);
});

test('a stale packument answering an older version does not count for an exact version', async () => {
  const c = clock();
  let polls = 0;
  const view = async () => (++polls <= 2 ? '0.9.0' : '1.0.0');
  await waitForRegistry({ packages: [PACKAGES[0]], spec: '1.0.0', view, ...c });
  assert.equal(c.sleeps.length, 2);
});

test('a dist-tag counts as soon as it resolves to any version', async () => {
  const c = clock();
  const result = await waitForRegistry({ packages: [PACKAGES[0]], spec: 'next', view: async () => '0.9.0', ...c });
  assert.deepEqual(result, { [PACKAGES[0]]: '0.9.0' });
});

test('caps the delay and fails with the missing packages once the timeout is spent', async () => {
  const c = clock();
  await assert.rejects(
    waitForRegistry({
      packages: PACKAGES,
      spec: '1.0.0',
      view: async (name) => (name === PACKAGES[0] ? '1.0.0' : null),
      ...c,
      timeoutMs: 100_000,
      initialDelayMs: 10_000,
      maxDelayMs: 30_000,
    }),
    (err) => {
      assert.match(err.message, /@marinoscar\/platform-api@1\.0\.0/);
      assert.doesNotMatch(err.message, /platform-contract/);
      return true;
    },
  );
  assert.deepEqual(c.sleeps, [10_000, 20_000, 30_000, 30_000, 10_000]);
  assert.equal(c.now(), 100_000);
});
