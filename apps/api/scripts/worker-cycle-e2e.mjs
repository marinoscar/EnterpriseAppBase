#!/usr/bin/env node
// =============================================================================
// The real worker cycle, with no Docker daemon  (issue #881)
// =============================================================================
//
// Worker nodes are critical and their packaged pieces are tested one at a
// time (the CLI engine against a fake API, the API against a fake node). This
// script is the one place they meet. It proves, end to end, that
//
//   1. the COMPILED API (`dist/main.js`, the artifact the Dockerfile runs)
//      serves the node plane against a real PostgreSQL;
//   2. a node is ENROLLED with the packaged flow (`node enroll`: the device
//      authorization flow, approved here by an admin, then a `nod_` credential)
//      and REGISTERED (`node register`);
//   3. the packaged node DAEMON (`node start`, the `@marinoscar/platform-cli`
//      engine) claims a node-eligible job, runs a test executor, and SETTLES
//      it, and the API persists the result the node posted;
//   4. the job-scoped credential is brokered to the node IN MEMORY ONLY and
//      REVOKED when the job settles (CLAUDE.md queue rule 3): not in the
//      node's config, state directory or logs, not in the API's log, not in
//      any `job_node_secrets` column, and refused after the settle.
//
// WHAT IS NOT THE PACKAGED THING, AND WHY. The reference app ships no
// node-eligible job type that needs no external service, so `worker-e2e/
// test-module.cjs` adds one (plus a secret broker) to the root of the app, via
// `node -r`, without changing the artifact. `worker-e2e/node-cli.mjs` is the
// packaged CLI (`createCli`) with the matching executor. Everything between
// them is the production code path.
//
// PREREQUISITES (the CI job `worker-e2e` runs them as separate steps):
//
//   npm run build:packages
//   npm run build            --workspace=api
//   npm run prisma:migrate   --workspace=api
//   npm run prisma:seed      --workspace=api
//
// then `npm run test:worker-e2e --workspace=api`, with the POSTGRES_* and
// secret variables the API itself reads. Environment knobs: E2E_PORT (default
// 3012), E2E_TIMEOUT_MS (the whole cycle, default 120000).
// =============================================================================

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adminNodeCredentialSchema, adminNodeSchema } from '@marinoscar/platform-contract/nodes';
import pg from 'pg';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entrypoint = resolve(apiRoot, 'dist', 'main.js');
const preload = resolve(apiRoot, 'scripts', 'worker-e2e', 'test-module.cjs');
const nodeCli = resolve(apiRoot, 'scripts', 'worker-e2e', 'node-cli.mjs');

const PORT = process.env.E2E_PORT ?? '3012';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 120_000);
const JOB_TYPE = 'e2e.worker-cycle';
const SALT = randomBytes(12).toString('hex');
const WORK_DIR = mkdtempSync(join(tmpdir(), 'worker-e2e-'));
const HOME = join(WORK_DIR, 'home');
mkdirSync(HOME);

const children = new Set();
const steps = [];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function step(name) {
  steps.push(name);
  process.stdout.write(`[worker-e2e] ${name}\n`);
}

if (!existsSync(entrypoint)) {
  console.error(`[worker-e2e] ${entrypoint} does not exist. Run \`npm run build --workspace=api\` first.`);
  process.exit(2);
}

// ---- processes ------------------------------------------------------------

function start(command, args, { env, logFile }) {
  const log = createWriteStream(logFile);
  const child = spawn(command, args, { cwd: apiRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { child, output: '', exited: false, code: null };
  const collect = (chunk) => {
    state.output += chunk.toString();
    log.write(chunk);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('exit', (code) => {
    state.exited = true;
    state.code = code;
    log.end();
  });
  children.add(state);
  return state;
}

async function stop(state, signal = 'SIGTERM', waitMs = 20_000) {
  if (state.exited) return;
  state.child.kill(signal);
  const deadline = Date.now() + waitMs;
  while (!state.exited && Date.now() < deadline) await sleep(100);
  if (!state.exited) state.child.kill('SIGKILL');
}

async function waitFor(description, probe, { timeoutMs = 60_000, everyMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await sleep(everyMs);
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${description}`);
}

/** Runs a packaged CLI command to completion. */
async function runCli(args) {
  const state = start(process.execPath, [nodeCli, ...args], {
    env: cliEnv(),
    logFile: join(WORK_DIR, `cli-${args.slice(0, 2).join('-')}.log`),
  });
  await waitFor(`\`node ${args.join(' ')}\` to exit`, () => state.exited, { timeoutMs: 60_000, everyMs: 100 });
  return state;
}

function cliEnv() {
  // HOME isolates the node's config and state directory; nothing else of the
  // parent's environment is needed by the CLI.
  return { PATH: process.env.PATH, HOME, E2E_NODE_NO_COLOR: '1', NO_COLOR: '1' };
}

// ---- HTTP -------------------------------------------------------------------

async function http(method, path, { token, body, raw = false } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (raw) return response;
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 400)}`);
  return json && typeof json === 'object' && 'data' in json ? json.data : json;
}

async function adminToken() {
  const response = await http('POST', '/api/auth/test/login', {
    body: { email: 'worker-e2e-admin@example.test', role: 'admin' },
    raw: true,
  });
  assert.equal(response.status, 302, 'the test login redirects with a token');
  const token = new URL(response.headers.get('location')).searchParams.get('token');
  assert.ok(token, 'the test login redirect carries an access token');
  return token;
}

// ---- file scans ---------------------------------------------------------------

function filesUnder(root) {
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else if (statSync(path).isFile()) found.push(path);
  }
  return found;
}

function filesContaining(root, needle) {
  return filesUnder(root).filter((file) => readFileSync(file).includes(needle));
}

// ---- the cycle ------------------------------------------------------------------

async function main() {
  const apiLog = join(WORK_DIR, 'api.log');
  const api = start(process.execPath, ['-r', preload, entrypoint], {
    logFile: apiLog,
    env: {
      ...process.env,
      // Not `production`: the test login (`TestAuthModule`) is mounted only
      // outside it, and it is how this script becomes an administrator.
      NODE_ENV: 'test',
      PORT,
      // `system` mode leaves node-eligible types to the nodes, so a succeeded
      // job can only have run on one.
      JOBS_WORKER_MODE: 'system',
      E2E_WORKER_CYCLE: '1',
      E2E_SECRET_SALT: SALT,
      OTEL_ENABLED: 'false',
    },
  });

  step('boot the compiled API');
  await waitFor(
    'the API to be ready',
    async () => {
      assert.equal(api.exited, false, `the API exited early (code ${api.code}):\n${api.output.slice(-3000)}`);
      try {
        return (await fetch(`${BASE_URL}/api/health/ready`)).ok;
      } catch {
        return false;
      }
    },
    { timeoutMs: 90_000 },
  );

  const admin = await adminToken();

  step('allow credential brokering (nodes.jobSecretBrokerEnabled)');
  await http('PATCH', '/api/system-settings', { token: admin, body: { nodes: { jobSecretBrokerEnabled: true } } });

  step('enrol the node with the packaged flow (device authorization, then a nod_ credential)');
  const enroll = start(
    process.execPath,
    [nodeCli, 'node', 'enroll', '--server', BASE_URL, '--name', 'worker-e2e credential', '--no-browser', '--show-token'],
    { env: cliEnv(), logFile: join(WORK_DIR, 'cli-enroll.log') },
  );
  const userCode = await waitFor('the device code', () => enroll.output.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/)?.[1], {
    timeoutMs: 30_000,
    everyMs: 100,
  });
  await http('POST', '/api/auth/device/authorize', { token: admin, body: { userCode, approve: true } });
  await waitFor('`node enroll` to finish', () => enroll.exited, { timeoutMs: 60_000, everyMs: 200 });
  assert.equal(enroll.code, 0, `node enroll failed:\n${enroll.output}`);
  const nodeToken = enroll.output.match(/\bnod_[A-Za-z0-9_-]+/)?.[0];
  assert.ok(nodeToken, '--show-token printed the nod_ credential');

  step('register the node');
  const registered = await runCli(['node', 'register', '--name', 'worker-e2e-node', '--types', JOB_TYPE, '--concurrency', '1', '--json']);
  assert.equal(registered.code, 0, `node register failed:\n${registered.output}`);
  const nodeId = JSON.parse(registered.output.slice(registered.output.indexOf('{'))).id;
  assert.match(nodeId, /^[0-9a-f-]{36}$/);

  step('start the packaged node daemon');
  const daemon = start(process.execPath, [nodeCli, 'node', 'start', '--headless'], {
    env: cliEnv(),
    logFile: join(WORK_DIR, 'cli-daemon.log'),
  });

  step('enqueue a node-eligible job');
  const { id: jobId } = await http('POST', '/api/e2e/enqueue', { body: { echo: 'hello from the server' } });
  assert.match(jobId, /^[0-9a-f-]{36}$/);

  step('the job is claimed, executed and settled by the node');
  const job = await waitFor(
    'the job to settle',
    async () => {
      assert.equal(daemon.exited, false, `the node daemon exited (code ${daemon.code}):\n${daemon.output.slice(-3000)}`);
      const page = await http('GET', `/api/admin/jobs?type=${JOB_TYPE}&pageSize=20`, { token: admin });
      const row = page.items.find((candidate) => candidate.id === jobId);
      if (row && row.status === 'failed') throw new Error(`the job failed: ${row.lastError}\n${daemon.output.slice(-2000)}`);
      return row && row.status === 'succeeded' ? row : null;
    },
    { timeoutMs: TIMEOUT_MS - 30_000, everyMs: 1000 },
  );
  assert.equal(job.executor, 'node', 'the job records a node as its executor');
  assert.equal(job.attempts, 1);

  step('the result the node posted is persisted by the API');
  const results = await http('GET', '/api/e2e/results');
  const persisted = results.find((row) => row.jobId === jobId);
  assert.ok(persisted, 'persistNodeResult wrote a row');
  assert.equal(persisted.result.echo, 'hello from the server');
  assert.equal(persisted.result.computedBy, 'node');
  assert.equal(persisted.result.secretKind, 'e2e.token');
  assert.equal(
    persisted.result.secretSha256,
    createHash('sha256').update(`e2e-secret-${SALT}-${jobId}`).digest('hex'),
    'the node received exactly the credential the broker minted for this job',
  );

  step('the admin responses parse against the contract schemas');
  const nodes = await http('GET', '/api/admin/nodes', { token: admin });
  const mine = nodes.map((candidate) => adminNodeSchema.parse(candidate)).find((candidate) => candidate.id === nodeId);
  assert.ok(mine, 'the node is in the fleet');
  assert.equal(mine.status, 'online');
  assert.equal(mine.health, 'healthy');
  assert.deepEqual(mine.eligibleTypes, [JOB_TYPE]);
  assert.equal(mine.concurrency, 1);
  assert.ok(mine.lastHeartbeatAt, 'the daemon heartbeats');
  const credentials = (await http('GET', '/api/admin/nodes/credentials', { token: admin })).map((row) =>
    adminNodeCredentialSchema.parse(row),
  );
  const credential = credentials.find((row) => nodeToken.startsWith(row.tokenPrefix));
  assert.ok(credential && credential.revokedAt === null, 'the enrolled credential is live');
  for (const row of credentials) assert.equal('token' in row, false, 'a credential list never carries a token');

  step('the job credential is revoked when the job settles');
  const db = new pg.Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 1,
  });
  try {
    const grant = await waitFor(
      'the grant to be revoked',
      async () => {
        const { rows } = await db.query('SELECT * FROM job_node_secrets WHERE job_id = $1', [jobId]);
        return rows.length === 1 && rows[0].revoked_at ? rows[0] : null;
      },
      { timeoutMs: 20_000 },
    );
    assert.equal(grant.kind, 'e2e.token');
    assert.equal(grant.handle, `e2e-grant-${jobId}`);
    assert.equal(grant.node_id, nodeId);
    assert.equal(JSON.stringify(grant).includes(SALT), false, 'job_node_secrets holds the handle, never the material');
  } finally {
    await db.end();
  }
  const brokerGrants = await http('GET', '/api/e2e/grants');
  assert.deepEqual(
    brokerGrants.map(({ jobId: id, issued, revoked }) => ({ id, issued, revoked })),
    [{ id: jobId, issued: 1, revoked: true }],
    'one grant was issued for the job, once, and the broker revoked it',
  );
  const late = await http('POST', `/api/nodes/${nodeId}/jobs/${jobId}/secret`, { token: nodeToken, body: {}, raw: true });
  assert.ok(late.status >= 400 && late.status < 500, `a settled job's secret is refused (got ${late.status})`);
  assert.equal((await late.text()).includes(SALT), false);

  step('the credential never touched the node, the logs or the database');
  assert.deepEqual(filesContaining(HOME, SALT), [], 'no file under the node home (config, state, logs) holds the job credential');
  assert.deepEqual(filesContaining(WORK_DIR, SALT), [], 'no captured process output holds the job credential');
  assert.ok(filesUnder(HOME).length > 0, 'the node did write its config and logs (the scan is not vacuous)');

  step('the daemon stops cleanly');
  await stop(daemon);
  assert.equal(daemon.code, 0, `the daemon exits 0 on SIGTERM:\n${daemon.output.slice(-2000)}`);
  await stop(api);

  process.stdout.write(`[worker-e2e] OK, ${steps.length} steps\n`);
}

let failed = false;
const watchdog = setTimeout(() => {
  console.error(`[worker-e2e] aborted: the cycle did not finish in ${TIMEOUT_MS} ms`);
  failed = true;
  void cleanup().then(() => process.exit(1));
}, TIMEOUT_MS);

async function cleanup() {
  for (const state of children) await stop(state, 'SIGTERM', 5_000);
}

try {
  await main();
} catch (error) {
  failed = true;
  console.error(`[worker-e2e] FAILED after "${steps.at(-1)}":\n${error instanceof Error ? (error.stack ?? error.message) : error}`);
  for (const file of ['api.log', 'cli-daemon.log', 'cli-enroll.log']) {
    const path = join(WORK_DIR, file);
    if (existsSync(path)) console.error(`---- ${file} (tail) ----\n${readFileSync(path, 'utf8').slice(-4000)}`);
  }
} finally {
  clearTimeout(watchdog);
  await cleanup();
  if (!failed) rmSync(WORK_DIR, { recursive: true, force: true });
  else console.error(`[worker-e2e] kept ${WORK_DIR} for inspection`);
}
process.exit(failed ? 1 : 0);
