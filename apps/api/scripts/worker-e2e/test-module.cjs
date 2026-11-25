'use strict';
// =============================================================================
// The test-only half of the worker-cycle e2e  (issue #881)
// =============================================================================
//
// Loaded with `node -r` in front of the COMPILED API (`dist/main.js`), by
// `../worker-cycle-e2e.mjs` only. It adds one module to the root of the app the
// artifact boots, and nothing else about the artifact changes:
//
//   - `e2e.worker-cycle`, a node-eligible job type (`nodeResultSchema` +
//     `persistNodeResult`) whose handler REFUSES to run on the server, so a
//     succeeded job can only have been executed by a node.
//   - a `JobSecretBroker` of kind `e2e.token`, so the job-scoped credential
//     path (`POST /api/nodes/:id/jobs/:jobId/secret`, memory-only on the node,
//     revoked on settle; CLAUDE.md queue rule 3) is exercised end to end.
//   - three routes under `/api/e2e/*` for the test to enqueue the job and read
//     back what the broker and the persist step recorded.
//
// The reference app ships no node-eligible job type that needs no external
// service (the checksum needs object storage, the backup needs a bucket), so a
// type has to come from somewhere. It lives here, outside `src/`, so it is
// never part of the artifact that is deployed, and the preload is refused
// unless `E2E_WORKER_CYCLE=1` is set.
//
// ⚠ The credential MATERIAL is derived from a salt the test chooses
// (`E2E_SECRET_SALT`), so the test can search the node's state directory, the
// node's logs, the API log and the database for it without this file ever
// handing the material back over a route. It never reaches a log line here.
//
// Plain CommonJS with the decorators applied by hand: there is no TypeScript
// step between this file and the artifact.
// =============================================================================

if (process.env.E2E_WORKER_CYCLE !== '1') {
  throw new Error('worker-e2e/test-module.cjs is test-only: set E2E_WORKER_CYCLE=1 to load it.');
}

const { createHash } = require('node:crypto');

const { Body, Controller, Get, HttpCode, Inject, Injectable, Module, Post } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { JobHandlerRegistry, JobsService } = require('@marinoscar/platform-api/jobs');
const { Pool } = require('pg');
const { z } = require('zod');

const JOB_TYPE = 'e2e.worker-cycle';
const BROKER_KIND = 'e2e.token';
const SALT = process.env.E2E_SECRET_SALT;
if (!SALT) throw new Error('E2E_SECRET_SALT is required');

/** The material the broker issues for a job, derived so the test can recompute it. */
function materialFor(jobId) {
  return { token: `e2e-secret-${SALT}-${jobId}` };
}
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  max: 2,
});

/** What the broker did, by job id; read back through `GET /api/e2e/grants`. */
const grants = new Map();

const broker = {
  kind: BROKER_KIND,
  async usable() {
    return { ok: true };
  },
  // Idempotent per job: a second call extends the SAME grant (same handle).
  async issue(job, until) {
    const handle = `e2e-grant-${job.id}`;
    const entry = grants.get(job.id) ?? { handle, jobId: job.id, issued: 0, revoked: false };
    entry.issued += 1;
    entry.revoked = false;
    grants.set(job.id, entry);
    return { handle, expiresAt: until, material: materialFor(job.id) };
  },
  async revoke(handle) {
    for (const entry of grants.values()) if (entry.handle === handle) entry.revoked = true;
  },
};

class E2eWorkerCycleHandler {
  constructor(registry) {
    this.registry = registry;
    this.type = JOB_TYPE;
    this.label = 'E2E worker cycle';
    this.profile = { maxRuntimeMs: 60_000, maxAttempts: 1 };
    this.nodeSecretBroker = broker;
    this.nodeResultSchema = z
      .object({
        echo: z.string().max(200),
        secretKind: z.string().max(100),
        secretSha256: z.string().regex(/^[0-9a-f]{64}$/),
        computedBy: z.literal('node'),
      })
      .strict();
  }

  onModuleInit() {
    this.registry.register(this);
  }

  // A node-eligible job must be taken by a node. If the server's own worker
  // ever claims this one, the cycle under test did not happen: fail loudly.
  async process() {
    throw new Error(`${JOB_TYPE} must run on a worker node, not on the API server`);
  }

  async persistNodeResult(job, result) {
    await pool.query(
      'INSERT INTO e2e_worker_results (job_id, result) VALUES ($1, $2) ON CONFLICT (job_id) DO UPDATE SET result = EXCLUDED.result',
      [job.id, JSON.stringify(result)],
    );
  }

  async onApplicationBootstrap() {
    await pool.query('CREATE TABLE IF NOT EXISTS e2e_worker_results (job_id uuid PRIMARY KEY, result jsonb NOT NULL)');
  }
}
Injectable()(E2eWorkerCycleHandler);
Inject(JobHandlerRegistry)(E2eWorkerCycleHandler, undefined, 0);

class E2eController {
  constructor(jobs) {
    this.jobs = jobs;
  }

  async enqueue(body) {
    const job = await this.jobs.enqueue({
      type: JOB_TYPE,
      reason: 'backfill',
      payload: { echo: String(body?.echo ?? 'hello') },
      orgId: null,
      skipDedup: true,
    });
    return { id: job.id };
  }

  async listGrants() {
    return [...grants.values()];
  }

  async results() {
    const { rows } = await pool.query('SELECT job_id, result FROM e2e_worker_results');
    return rows.map((row) => ({ jobId: row.job_id, result: row.result }));
  }
}
Injectable()(E2eController);
Inject(JobsService)(E2eController, undefined, 0);
Controller('e2e')(E2eController);
function route(method, name, decorators, bodyIndex) {
  const descriptor = Object.getOwnPropertyDescriptor(E2eController.prototype, name);
  for (const decorator of decorators) decorator(E2eController.prototype, name, descriptor);
  if (bodyIndex !== undefined) Body()(E2eController.prototype, name, bodyIndex);
  void method;
}
route('post', 'enqueue', [Post('enqueue'), HttpCode(200)], 0);
route('get', 'listGrants', [Get('grants')]);
route('get', 'results', [Get('results')]);

class E2eWorkerCycleModule {}
Module({ controllers: [E2eController], providers: [E2eWorkerCycleHandler] })(E2eWorkerCycleModule);

// Wrap the root module `main.ts` hands to `NestFactory.create`.
const originalCreate = NestFactory.create.bind(NestFactory);
NestFactory.create = (rootModule, ...rest) => {
  class E2eRootModule {}
  Module({ imports: [rootModule, E2eWorkerCycleModule] })(E2eRootModule);
  return originalCreate(E2eRootModule, ...rest);
};

module.exports = { materialFor, sha256 };
