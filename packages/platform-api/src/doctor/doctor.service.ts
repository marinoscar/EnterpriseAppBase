// =============================================================================
// DoctorService — runs the registered checks into one report (issue #634; packaged by #696)
// =============================================================================
//
// WHAT THIS OWNS, so no check has to:
//
//   - PARALLELISM. Every check whose dependencies have settled starts at once;
//     a dependent check starts the moment its last dependency settles. That is
//     "dependency waves" without a wave barrier: a slow telemetry probe never
//     delays an unrelated storage one.
//   - DEPENDENCIES. A check whose `dependsOn` contains a `fail` or a `skip` is
//     reported as `skip` and never run: "bucket unreachable" beneath "storage
//     not configured" is noise, and running it would only time out.
//   - FAILURE CONTAINMENT. A throw becomes `fail` with the error's message; a
//     hang becomes `fail` after `timeoutMs` (default `defaultTimeoutMs`, 5000). One broken check
//     never costs the operator the rest of the list.
//   - NORMALISATION. `detail` is forced to one line; a `warn`/`fail` with no
//     remedy gets a generic one naming its settings page.
//   - CACHING. The report is cached for `cacheTtlMs` (15 s) per filter, so a page that polls,
//     or two admins opening it together, do not multiply the probes. In-flight
//     runs are shared too. `refresh: true` bypasses (and replaces) the cache.
//
// Read-only by construction: this file writes nothing, and the checks it runs
// are bound by the same rule (see `doctor-check.interface.ts`).
// =============================================================================

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import {
  DOCTOR_STATUSES,
  PLATFORM_DOCTOR_CATEGORIES,
  DOCTOR_STATUS_RANK,
  DoctorCheck,
  DoctorCheckOutcome,
  DoctorStatus,
} from './doctor-check.interface';
import { DoctorCheckRegistry } from './doctor-check.registry';
import { DOCTOR_MODULE_OPTIONS, ResolvedDoctorModuleOptions } from './doctor.options';
import { DoctorCheckReport, DoctorReport } from './dto/doctor-report.dto';

/**
 * Per-check ceiling when a check declares none: the default of `defaultTimeoutMs`.
 *
 * @stability stable
 */
export const DOCTOR_DEFAULT_TIMEOUT_MS = 5_000;

/**
 * How long a report is served from memory: the default of `cacheTtlMs`.
 *
 * @stability stable
 */
export const DOCTOR_CACHE_TTL_MS = 15_000;

/** A `detail` longer than this is cut: it is one line in a table. */
const MAX_DETAIL_LENGTH = 500;

/**
 * Remedy for a warn/fail with no settings page and no remedy of its own.
 *
 * @stability stable
 */
export const DOCTOR_FALLBACK_REMEDY = 'See the API logs for details.';

/**
 * What {@link DoctorService.run} takes.
 *
 * @stability stable
 */
export interface DoctorRunOptions {
  /** Only the checks in this category (plus, unreported, whatever they depend on). */
  category?: string;
  /** Bypass (and replace) the cached report. */
  refresh?: boolean;
}

interface CacheEntry {
  at: number;
  report: Promise<DoctorReport>;
}

/**
 * The worst of `statuses`; `skip` when there are none (nothing was proven).
 *
 * @param statuses - the statuses to fold.
 * @returns the worst, ordered `pass < skip < warn < fail`.
 *
 * @stability stable
 */
export function worstStatus(statuses: DoctorStatus[]): DoctorStatus {
  if (statuses.length === 0) return 'skip';

  return statuses.reduce((worst, status) =>
    DOCTOR_STATUS_RANK[status] > DOCTOR_STATUS_RANK[worst] ? status : worst,
  );
}

function oneLine(text: string): string {
  const flat = text.replace(/\s*[\r\n]+\s*/g, ' ').trim();

  return flat.length > MAX_DETAIL_LENGTH ? `${flat.slice(0, MAX_DETAIL_LENGTH - 1)}…` : flat;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return oneLine(error.message || error.name);

  return oneLine(String(error));
}

/**
 * Runs the registered checks into one report: parallel, dependency-aware,
 * time-boxed, normalised and briefly cached. Provided by `DoctorModule.forRoot()`.
 *
 * @stability stable
 */
@Injectable()
export class DoctorService {
  private readonly logger = new Logger(DoctorService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly categoryOrder: readonly string[];
  private readonly defaultTimeoutMs: number;
  private readonly cacheTtlMs: number;

  /** Overridable in tests. */
  protected now: () => number = () => Date.now();

  /**
   * @param registry - the checks to run.
   * @param options - the module's resolved options; the defaults when absent
   *   (`PLATFORM_DOCTOR_CATEGORIES`, 5000 ms, 15000 ms).
   */
  constructor(
    @Inject(DoctorCheckRegistry) private readonly registry: DoctorCheckRegistry,
    @Optional()
    @Inject(DOCTOR_MODULE_OPTIONS)
    options?: Pick<ResolvedDoctorModuleOptions, 'categoryOrder' | 'defaultTimeoutMs' | 'cacheTtlMs'>,
  ) {
    this.categoryOrder = options?.categoryOrder ?? PLATFORM_DOCTOR_CATEGORIES;
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? DOCTOR_DEFAULT_TIMEOUT_MS;
    this.cacheTtlMs = options?.cacheTtlMs ?? DOCTOR_CACHE_TTL_MS;
  }

  /**
   * The report for every check, or for one `category`. Never throws for a check's sake.
   *
   * @param options - the category filter and the cache bypass.
   * @returns the report; served from the cache for `cacheTtlMs` unless `refresh`.
   */
  async run(options: DoctorRunOptions = {}): Promise<DoctorReport> {
    const key = options.category ?? '*';
    const cached = this.cache.get(key);

    if (!options.refresh && cached && this.now() - cached.at < this.cacheTtlMs) {
      return cached.report;
    }

    // Expired entries are dropped here, so arbitrary `category` values cannot
    // grow the map past what one TTL of requests can put in it.
    for (const [k, e] of this.cache) {
      if (this.now() - e.at >= this.cacheTtlMs) this.cache.delete(k);
    }

    const report = this.execute(options.category);
    const entry: CacheEntry = { at: this.now(), report };
    this.cache.set(key, entry);

    // A run that itself blew up (it should not — every check is guarded) must
    // not be served from the cache for the next 15 seconds.
    report.catch(() => {
      if (this.cache.get(key) === entry) this.cache.delete(key);
    });

    return report;
  }

  /** Drops every cached report. */
  invalidate(): void {
    this.cache.clear();
  }

  private async execute(category: string | undefined): Promise<DoctorReport> {
    const started = this.now();
    const all = this.registry.list();
    const byId = new Map(all.map((check) => [check.id, check]));
    const order = new Map(all.map((check, index) => [check.id, index]));

    const reported = category === undefined ? all : all.filter((check) => check.category === category);
    const cyclic = this.findCycles(all);
    const results = new Map<string, Promise<DoctorCheckReport>>();

    const resultFor = (check: DoctorCheck): Promise<DoctorCheckReport> => {
      let result = results.get(check.id);

      if (!result) {
        result = this.evaluate(check, byId, cyclic, resultFor);
        results.set(check.id, result);
      }

      return result;
    };

    const checks = await Promise.all(reported.map((check) => resultFor(check)));

    const categoryRank = (category: string): number => {
      const index = this.categoryOrder.indexOf(category);

      return index === -1 ? this.categoryOrder.length : index;
    };

    checks.sort(
      (a, b) =>
        categoryRank(a.category) - categoryRank(b.category) ||
        (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );

    return {
      verdict: worstStatus(checks.map((check) => check.status)),
      generatedAt: new Date(started).toISOString(),
      durationMs: Math.max(0, Math.round(this.now() - started)),
      checks,
    };
  }

  private async evaluate(
    check: DoctorCheck,
    byId: Map<string, DoctorCheck>,
    cyclic: Set<string>,
    resultFor: (check: DoctorCheck) => Promise<DoctorCheckReport>,
  ): Promise<DoctorCheckReport> {
    if (cyclic.has(check.id)) {
      return this.toReport(check, {
        status: 'fail',
        detail: `Dependency cycle: "${check.id}" depends on itself through dependsOn.`,
        remedy: 'Fix the dependsOn declarations of the checks in this cycle.',
      }, 0);
    }

    for (const depId of check.dependsOn ?? []) {
      const dep = byId.get(depId);

      if (!dep) {
        return this.toReport(check, {
          status: 'skip',
          detail: `Skipped: the check "${depId}" it depends on is not registered`,
        }, 0);
      }
    }

    const deps = await Promise.all((check.dependsOn ?? []).map((depId) => resultFor(byId.get(depId)!)));
    const blocking = deps.find((dep) => dep.status === 'fail' || dep.status === 'skip');

    if (blocking) {
      return this.toReport(check, {
        status: 'skip',
        detail: `Skipped: ${blocking.label} did not pass`,
      }, 0);
    }

    const started = this.now();
    const outcome = await this.runGuarded(check);

    return this.toReport(check, outcome, Math.max(0, Math.round(this.now() - started)));
  }

  private async runGuarded(check: DoctorCheck): Promise<DoctorCheckOutcome> {
    const timeoutMs = check.timeoutMs ?? this.defaultTimeoutMs;
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<DoctorCheckOutcome>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            status: 'fail',
            detail: `Timed out after ${timeoutMs}ms`,
            remedy: check.settingsPath
              ? `The probe did not answer in time. Check the service is reachable, then review ${check.settingsPath}.`
              : 'The probe did not answer in time. Check the service it probes is reachable from the API.',
          }),
        timeoutMs,
      );
      timer.unref?.();
    });

    try {
      return await Promise.race([
        Promise.resolve().then(() => check.run()),
        timeout,
      ]);
    } catch (error) {
      this.logger.warn(`Doctor check "${check.id}" threw: ${errorMessage(error)}`);

      return {
        status: 'fail',
        detail: `The check failed: ${errorMessage(error)}`,
        error: errorMessage(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private toReport(check: DoctorCheck, outcome: DoctorCheckOutcome, durationMs: number): DoctorCheckReport {
    const valid = DOCTOR_STATUSES.includes(outcome?.status);
    const status: DoctorStatus = valid ? outcome.status : 'fail';
    const detail = !valid
      ? 'The check returned an invalid outcome.'
      : typeof outcome.detail === 'string' && outcome.detail.trim() !== ''
        ? oneLine(outcome.detail)
        : '(no detail)';

    let remedy = typeof outcome?.remedy === 'string' && outcome.remedy.trim() !== '' ? outcome.remedy.trim() : null;

    if (!remedy && (status === 'warn' || status === 'fail')) {
      remedy = check.settingsPath ? `Open ${check.settingsPath} to review.` : DOCTOR_FALLBACK_REMEDY;
    }

    return {
      id: check.id,
      category: check.category,
      label: check.label,
      settingsPath: check.settingsPath ?? null,
      status,
      detail,
      remedy,
      error: typeof outcome?.error === 'string' && outcome.error !== '' ? oneLine(outcome.error) : null,
      data: outcome?.data && Object.keys(outcome.data).length > 0 ? { ...outcome.data } : null,
      durationMs,
    };
  }

  /** Every check id that sits on a `dependsOn` cycle. */
  private findCycles(checks: DoctorCheck[]): Set<string> {
    const byId = new Map(checks.map((check) => [check.id, check]));
    const cyclic = new Set<string>();
    const state = new Map<string, 'visiting' | 'done'>();
    const stack: string[] = [];

    const visit = (id: string): void => {
      const seen = state.get(id);

      if (seen === 'done') return;
      if (seen === 'visiting') {
        for (const member of stack.slice(stack.indexOf(id))) cyclic.add(member);
        return;
      }

      const check = byId.get(id);
      if (!check) return;

      state.set(id, 'visiting');
      stack.push(id);
      for (const dep of check.dependsOn ?? []) visit(dep);
      stack.pop();
      state.set(id, 'done');
    };

    for (const check of checks) visit(check.id);

    return cyclic;
  }
}
