import type { RawIndexProblem, RlsProblem } from '../drift/index.js';
import type { BaselineErrorCode } from './errors.js';
import type { MatchedMigration } from './mapping.js';

/**
 * One reason the baseline will not write anything.
 *
 * @stability experimental
 */
export interface BaselineRefusal {
  /** The class of refusal. */
  code: BaselineErrorCode;
  /** What is wrong and how to fix it. */
  message: string;
}

/**
 * A migration `prisma migrate resolve --applied` runs for.
 *
 * @stability experimental
 */
export interface BaselineResolveItem {
  /** `platform:NNNN_slug`. */
  originId: string;
  /** The directory that is marked applied. */
  localDir: string;
  /** Whether the directory is created first (a migration with no directory), or already exists (a mapped one the ledger lacks). */
  install: boolean;
}

/**
 * A migration above `--through`: installed only.
 *
 * @stability experimental
 */
export interface BaselineInstallItem {
  /** `platform:NNNN_slug`. */
  originId: string;
  /** The directory that is created. */
  localDir: string;
}

/**
 * The statements of `prisma migrate diff` from the replayed package history to the live database.
 *
 * @stability experimental
 */
export interface BaselineDiff {
  /** Statements a declared deviation (`platform.lock` `deviations[].expectDiff`) expects, normalised. */
  allowed: string[];
  /** Every other statement, normalised; each one blocks the baseline. */
  blocking: string[];
}

/**
 * What the baseline found in `_prisma_migrations`.
 *
 * @stability experimental
 */
export interface BaselineLedgerState {
  /** False when the table does not exist (a database Prisma never managed). */
  managed: boolean;
  /** One line per failed, rolled-back, missing or mismatching row. */
  problems: string[];
}

/**
 * The result of step B6.
 *
 * @stability experimental
 */
export interface BaselineVerification {
  /** True when status, the offline check and the ledger comparison all passed. */
  ok: boolean;
  /** One line per failure. */
  problems: string[];
}

/**
 * What `platform db baseline` found and did.
 *
 * @stability experimental
 */
export interface BaselineReport {
  /** The origin id the database is claimed to equal (`--through`). */
  through: string;
  /** Package migrations matched to an existing directory (step B1). */
  matched: MatchedMigration[];
  /** Migrations `prisma migrate resolve --applied` runs for; `install` says whether the directory is created first. */
  toResolve: BaselineResolveItem[];
  /** Migrations above `--through`: installed only, `prisma migrate deploy` applies them. */
  toInstall: BaselineInstallItem[];
  /** Local directories no package migration matched; they are app history and left alone. */
  appOnly: string[];
  /** Package origin ids with no local directory. */
  unmatched: string[];
  /** `prisma migrate diff` from the package history (to `--through`) to the live database. `allowed` are statements a declared deviation expects; `blocking` is everything else. */
  diff: BaselineDiff;
  /** Raw-SQL indexes that are missing or whose definition differs (step B4). */
  indexProblems: RawIndexProblem[];
  /** Row-level-security policies that are missing, unlisted or not forced (step B4). */
  policyProblems: RlsProblem[];
  /** The `_prisma_migrations` ledger: whether Prisma manages the database, and the problems found. */
  ledger: BaselineLedgerState;
  /** Everything that blocks `--apply`; empty when the baseline can proceed. */
  refusals: BaselineRefusal[];
  /** Warnings that do not block. */
  notes: string[];
  /** What `--apply` did, in order (empty on a dry run). */
  actions: string[];
  /** The result of step B6 (only after `--apply`). */
  verify?: BaselineVerification;
  /** True when `platform.lock` already holds exactly what the plan would write. */
  lockUpToDate: boolean;
  /** True when files were written and migrations resolved. */
  applied: boolean;
}

/**
 * Whether a baseline run succeeded: nothing refused it and, when it applied, the verification passed.
 *
 * @param report - The result of `runBaseline`.
 * @returns True when the command should exit 0.
 * @stability experimental
 */
export function isBaselineClean(report: BaselineReport): boolean {
  return report.refusals.length === 0 && (report.verify?.ok ?? true);
}

/**
 * Renders the report as plain text lines (also a block to paste into an issue).
 *
 * @param report - The result of `runBaseline`.
 * @returns The lines.
 * @stability experimental
 */
export function renderReport(report: BaselineReport): string[] {
  const lines: string[] = [];
  const mode = report.applied ? 'APPLIED' : 'DRY RUN (nothing was written)';
  lines.push(`platform db baseline: ${mode}, through ${report.through}`);
  lines.push('');
  lines.push(`B1 map: ${report.matched.length} matched, ${report.unmatched.length} unmatched, ${report.appOnly.length} app-only`);
  for (const m of report.matched) {
    lines.push(`  ${m.originId} -> ${m.localDir}  [${m.kind}${m.localSha256 ? ', localSha256 recorded' : ''}]`);
  }
  for (const id of report.unmatched) lines.push(`  ${id} -> (no local directory)`);
  for (const dir of report.appOnly) lines.push(`  app-only: ${dir}`);
  lines.push('');
  lines.push(
    `B2 ledger: ${report.ledger.managed ? 'managed by Prisma Migrate' : 'no _prisma_migrations table (a database Prisma never managed)'}; ${report.ledger.problems.length} problem(s)`,
  );
  for (const p of report.ledger.problems) lines.push(`  ${p}`);
  lines.push('');
  lines.push(`B3 diff (package history to ${report.through} -> live database): ${report.diff.blocking.length} blocking, ${report.diff.allowed.length} declared`);
  for (const s of report.diff.allowed) lines.push(`  declared deviation: ${s}`);
  for (const s of report.diff.blocking) lines.push(`  BLOCKING: ${s}`);
  lines.push('');
  lines.push(`B4 raw-SQL indexes: ${report.indexProblems.length} problem(s)`);
  for (const p of report.indexProblems) lines.push(`  ${p.code}  ${p.message}`);
  lines.push('');
  lines.push(`B4 row-level security: ${report.policyProblems.length} problem(s)`);
  for (const p of report.policyProblems) lines.push(`  ${p.code}  ${p.message}`);
  lines.push('');
  lines.push(`B5 act: ${report.toResolve.length} to resolve, ${report.toInstall.length} to install only`);
  for (const r of report.toResolve) lines.push(`  ${report.applied ? 'resolved' : 'would resolve'} --applied ${r.localDir}${r.install ? ' (installed first)' : ''}  <- ${r.originId}`);
  for (const r of report.toInstall) lines.push(`  ${report.applied ? 'installed' : 'would install'} ${r.localDir}  <- ${r.originId} (prisma migrate deploy applies it)`);
  for (const a of report.actions) lines.push(`  action: ${a}`);
  if (report.verify) {
    lines.push('');
    lines.push(`B6 verify: ${report.verify.ok ? 'ok' : `${report.verify.problems.length} problem(s)`}`);
    for (const p of report.verify.problems) lines.push(`  ${p}`);
  }
  for (const n of report.notes) lines.push(`note: ${n}`);
  lines.push('');
  if (report.refusals.length) {
    lines.push(`REFUSED: ${report.refusals.length} reason(s); nothing was written`);
    for (const r of report.refusals) lines.push(`  ${r.code}  ${r.message}`);
  } else if (report.applied) {
    lines.push(report.verify?.ok === false ? 'baseline applied, but verification FAILED (see above)' : 'baseline applied and verified');
  } else if (report.unmatched.length === 0 && report.toResolve.length === 0 && report.lockUpToDate) {
    lines.push('nothing to do: platform.lock maps every package migration and the database records them');
  } else if (report.unmatched.length === 0 && report.toResolve.length === 0) {
    lines.push('dry run clean: every package migration is mapped and recorded; --apply writes platform.lock only (nothing is resolved)');
  } else {
    lines.push('dry run clean: re-run with --apply to write the lock and resolve');
  }
  return lines;
}
