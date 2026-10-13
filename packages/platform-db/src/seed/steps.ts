// The seed hook (PP-14.27): app-owned steps that run after the platform's own,
// under one idempotence contract and one log. Types and helpers only; the
// loop lives in seed-platform.ts.

import type { PlatformSeedInput, SeedLogger, SeedPrisma, SeedSummary } from './types.js';

/**
 * What a {@link SeedStep} reports: how many rows it inserted and how many it
 * changed. The idempotence contract is about the first number: a second run
 * over an unchanged database creates 0.
 *
 * @stability experimental
 */
export interface SeedStepResult {
  /** Rows inserted by this run. A second run over the same database inserts none. */
  created: number;
  /** Rows an existing value was refreshed on. Not constrained by the contract (a step may rewrite a derived column every run). */
  updated: number;
}

/**
 * What a {@link SeedStep} receives besides its client.
 *
 * @stability experimental
 */
export interface SeedStepContext {
  /** The seed's logger: the step's own lines go through the same sink as the platform's, so one run reads as one log. */
  log: SeedLogger;
  /** The input the platform half ran with (roles, permissions, `initialAdminEmail`, ...). Read-only. */
  input: Readonly<PlatformSeedInput>;
  /** What the platform half did, so a step can depend on it (for example on `defaultOrganizationCreated`). */
  platform: Readonly<SeedSummary>;
}

/**
 * One app seed step: a named, idempotent write, run after the platform's own.
 *
 * Rules, the same as the platform's:
 * - **Idempotent.** Every write is an upsert keyed on a natural unique, never a `findFirst` followed by a `create`. A second run reports `created: 0`.
 * - **Never deletes**, and never overwrites a value an administrator may have edited (`update: {}`).
 * - **Nest-free.** The seed runs under `ts-node --transpile-only` in an image that has no `src/`.
 *
 * `Tx` is the client type the step writes through: with a real Prisma client,
 * `seedPlatform` runs the step inside `prisma.$transaction`, so `tx` is the
 * transaction client and a failing step leaves none of its writes; with a
 * client that has no `$transaction` (a test fake) `tx` is the client itself.
 *
 * @example
 * ```ts
 * // Prisma.TransactionClient is the generated client's transaction type.
 * export const seedCoachDefaults: SeedStep<Prisma.TransactionClient> = {
 *   id: 'coach.defaults',
 *   async run(tx) {
 *     const before = await tx.allowedEmail.count({ where: { email: 'coach@example.test' } });
 *     await tx.allowedEmail.upsert({ where: { email: 'coach@example.test' }, update: {}, create: { email: 'coach@example.test', notes: 'Seeded coach' } });
 *     return { created: before === 0 ? 1 : 0, updated: 0 };
 *   },
 * };
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface SeedStep<Tx = SeedPrisma> {
  /**
   * Stable id, `lower-case.words-or_dashes` (`coach.defaults`). It names the step in the log and in the summary, must be unique among the run's steps and must not be one of the platform's own step names ({@link PLATFORM_SEED_STEP_IDS}).
   */
  id: string;
  /**
   * Writes the step's rows.
   *
   * @param tx - The transaction client (see the interface note).
   * @param ctx - The logger, the platform input and what the platform half did.
   * @returns How many rows were created and updated.
   */
  run(tx: Tx, ctx: SeedStepContext): Promise<SeedStepResult>;
}

/**
 * What one extra step did in a run, as `SeedSummary.extras` lists it.
 *
 * @stability experimental
 */
export interface SeedStepSummary extends SeedStepResult {
  /** The step's id. */
  id: string;
}

/**
 * The options of {@link seedPlatform}'s third argument (a bare `SeedLogger` is still accepted).
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface SeedPlatformOptions<Tx = SeedPrisma> {
  /** Receives one line per step, the platform's and the extras'. Default: silent. */
  log?: SeedLogger;
  /** App steps, run in array order after the platform's own, each in its own transaction. */
  extras?: ReadonlyArray<SeedStep<Tx>>;
}

/**
 * The ids the platform half logs under; an extra step may not reuse one.
 *
 * @stability experimental
 */
export const PLATFORM_SEED_STEP_IDS: ReadonlyArray<string> = Object.freeze([
  'roles',
  'permissions',
  'role-permissions',
  'system-settings',
  'allowlist',
  'default-organization',
]);

const STEP_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

/**
 * A refusal of the seed's extra steps: a malformed or duplicate id, a step
 * that returned a malformed result, or a step that threw.
 *
 * @stability experimental
 */
export class SeedStepError extends Error {
  /** The step the error is about. */
  readonly stepId: string;

  /**
   * @param stepId - The step.
   * @param message - What is wrong.
   * @param options - The thrown value, when a step threw.
   */
  constructor(stepId: string, message: string, options?: { cause?: unknown }) {
    super(`seed step "${stepId}": ${message}`, options);
    this.name = 'SeedStepError';
    this.stepId = stepId;
  }
}

/**
 * Checks a run's extra steps before anything is written.
 *
 * @param extras - The steps.
 * @throws SeedStepError for a malformed id, a reserved id, a duplicate id or a `run` that is not a function.
 * @stability experimental
 */
export function assertSeedSteps(extras: ReadonlyArray<SeedStep<never>>): void {
  const seen = new Set<string>();
  for (const step of extras) {
    if (typeof step.id !== 'string' || !STEP_ID.test(step.id)) {
      throw new SeedStepError(String(step.id), 'the id must be lower-case words joined by ".", "-" or "_" (for example "coach.defaults")');
    }
    if (PLATFORM_SEED_STEP_IDS.includes(step.id)) throw new SeedStepError(step.id, 'the id is one of the platform seed steps');
    if (seen.has(step.id)) throw new SeedStepError(step.id, 'two steps share this id');
    if (typeof step.run !== 'function') throw new SeedStepError(step.id, 'run must be a function');
    seen.add(step.id);
  }
}

/**
 * Validates what a step returned.
 *
 * @param id - The step.
 * @param value - The value `run` resolved to.
 * @returns The result, as `{ created, updated }`.
 * @throws SeedStepError when a count is missing, negative, fractional or not a number.
 * @stability experimental
 */
export function readSeedStepResult(id: string, value: unknown): SeedStepResult {
  const result = value as Partial<SeedStepResult> | null | undefined;
  for (const field of ['created', 'updated'] as const) {
    const count = result?.[field];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw new SeedStepError(id, `run must resolve to { created, updated } with non-negative integers; got ${field}=${String(count)}`);
    }
  }
  return { created: result!.created!, updated: result!.updated! };
}

/**
 * The idempotence conformance helper: runs the seed twice over the same
 * database and fails when the second run creates a row. Call it from the
 * app's real-database test, with the same input and steps `seed.ts` uses.
 * Jest- and Vitest-agnostic: it throws, it does not assert through a runner.
 *
 * @param seed - Runs the whole seed once and returns its summary: `() => seedPlatform(prisma, input, { extras })`.
 * @returns Both summaries, for further assertions.
 * @throws Error naming every step whose second run created rows (the platform's default organization included).
 * @example
 * ```ts
 * await assertSeedIdempotent(() => seedPlatform(prisma, platformSeedInputFrom(SEED_SNAPSHOT, {}), { extras: appSeedSteps }));
 * ```
 * @extensionPoint conformance
 * @stability experimental
 */
export async function assertSeedIdempotent(seed: () => Promise<SeedSummary>): Promise<{ first: SeedSummary; second: SeedSummary }> {
  const first = await seed();
  const second = await seed();
  const offenders: string[] = [];
  if (second.defaultOrganizationCreated) offenders.push('default-organization: created again');
  for (const step of second.extras ?? []) {
    if (step.created !== 0) offenders.push(`${step.id}: created ${step.created} row(s) on the second run`);
  }
  if (offenders.length > 0) {
    throw new Error(`the seed is not idempotent (a second run must create 0):\n${offenders.map((line) => `  ${line}`).join('\n')}`);
  }
  return { first, second };
}

/** @internal The structural slice of a client `seedPlatform` needs to open a transaction. */
export interface SeedTransactionHost {
  $transaction?: <R>(fn: (tx: never) => Promise<R>) => Promise<R>;
}

/**
 * Runs one step: inside `prisma.$transaction` when the client has one, else
 * against the client itself.
 *
 * @internal
 */
export async function runSeedStep(
  prisma: SeedPrisma & SeedTransactionHost,
  step: SeedStep<never>,
  ctx: SeedStepContext,
): Promise<SeedStepResult> {
  try {
    const raw =
      typeof prisma.$transaction === 'function'
        ? await prisma.$transaction((tx) => step.run(tx, ctx))
        : await step.run(prisma as never, ctx);
    return readSeedStepResult(step.id, raw);
  } catch (error) {
    if (error instanceof SeedStepError) throw error;
    throw new SeedStepError(step.id, (error as Error)?.message ?? String(error), { cause: error });
  }
}
