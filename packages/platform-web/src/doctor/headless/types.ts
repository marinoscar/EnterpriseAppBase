// The Doctor's wire types, hand-mirrored from `@marinoscar/platform-api/doctor`
// (`dto/doctor-report.dto.ts`) until the zod schemas move to
// `@marinoscar/platform-contract` (#701).

/**
 * The four outcomes of a check. Severity order: `pass < skip < warn < fail`.
 *
 * @stability stable
 */
export type DoctorStatus = 'pass' | 'warn' | 'fail' | 'skip';

/**
 * Every status, lowest severity first.
 *
 * @stability stable
 */
export const DOCTOR_STATUS_ORDER: readonly DoctorStatus[] = ['pass', 'skip', 'warn', 'fail'];

/**
 * One row of the report.
 *
 * @stability stable
 */
export interface DoctorCheckReport {
  /** Stable dotted id, e.g. `storage.bucket`. */
  id: string;
  /** `core`, `auth`, `storage`, ...; an app may add its own. */
  category: string;
  /** Short human label. */
  label: string;
  /** Where the admin fixes this check, or `null` when no settings page owns it. */
  settingsPath: string | null;
  /** The verdict. */
  status: DoctorStatus;
  /** One line: what was found. */
  detail: string;
  /** What to do about a `warn` or `fail`. */
  remedy: string | null;
  /** Verbatim underlying error (provider message, errno), or `null`. */
  error: string | null;
  /** Small scalar facts: counts, versions, latencies. */
  data: Record<string, string | number | boolean | null> | null;
  /** How long the check took, in milliseconds; 0 when skipped. */
  durationMs: number;
}

/**
 * The whole report. A failing check is a successful response: it lands here,
 * never as an error.
 *
 * @stability stable
 */
export interface DoctorReport {
  /** The worst status across `checks`. */
  verdict: DoctorStatus;
  /** When the report was produced (ISO 8601). */
  generatedAt: string;
  /** Wall time of the whole run, in milliseconds. */
  durationMs: number;
  /** One row per check, sorted by category, then registration order. */
  checks: DoctorCheckReport[];
}

/**
 * What a report request may ask for.
 *
 * @stability stable
 */
export interface DoctorReportQuery {
  /** Restrict the run to one category. */
  category?: string;
  /** Bypass any server-side cache and run every probe again. */
  refresh?: boolean;
}
