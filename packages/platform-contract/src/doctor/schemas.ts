// =============================================================================
// The Doctor's wire shapes (issue #634; moved here from
// `@marinoscar/platform-api/doctor` by #701)
// =============================================================================
//
// ALWAYS A 200 FOR AN AUTHORIZED CALLER. A failing check is a row with
// `status: 'fail'`, never an error status: the report is read precisely when
// something is wrong, and a 500 or a 503 would withhold the list of what.
//
// Every nullable field is present on every row (`null` rather than absent), so
// a client renders one shape without optional-chaining through it.
//
// ⚠ OpenAPI is generated from these schemas (nestjs-zod, through the DTOs of
// `@marinoscar/platform-api/doctor`). Field order, `.describe()` texts and the
// order of the status enum are part of the published document: change them
// only as a deliberate API change.
// =============================================================================

import { z } from 'zod';

import type { DoctorStatus } from './constants.js';
import { SUPPORT_BUNDLE_REDACTION_RULES, SUPPORT_BUNDLE_VERSION } from './constants.js';

/**
 * The entries of {@link doctorStatusSchema}, as `z.enum` types them: each
 * status keyed by itself. Named so the schema's type reads as a reference.
 *
 * @stability stable
 */
export type DoctorStatusEnum = { [S in DoctorStatus]: S };

/**
 * The entries of the `refresh` query parameter: the strings `'true'` and
 * `'false'`, each keyed by itself, as `z.enum` types them.
 *
 * @stability stable
 */
export type DoctorBooleanStringEnum = { [S in 'true' | 'false']: S };

/**
 * A check's status on the wire.
 *
 * The enum lists the values in the order the OpenAPI document has always
 * published (`pass, warn, fail, skip`), which is not the severity order of
 * {@link DOCTOR_STATUSES}; rank statuses with {@link DOCTOR_STATUS_RANK}.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const doctorStatusSchema: z.ZodEnum<DoctorStatusEnum> = z
  .enum(['pass', 'warn', 'fail', 'skip'])
  .describe(
    '`pass` — verified healthy. `warn` — works, but needs attention. `fail` — broken. ' +
      '`skip` — not evaluated: a check it depends on did not pass, or the capability is ' +
      'intentionally switched off.',
  );

/**
 * One row of the report, as `GET /api/admin/doctor` returns it.
 *
 * Fields: `id` (stable dotted id, `storage.bucket`), `category` (`core`,
 * `auth`, ...; an app may add its own), `label`, `settingsPath` (the web route
 * that fixes it, or `null`), `status`, `detail` (one line: what was found),
 * `remedy` (set on `warn` and `fail`, otherwise `null`), `error` (the
 * underlying probe error, or `null`), `data` (small scalar facts, never secret
 * material, or `null`) and `durationMs` (0 when skipped without running).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const doctorCheckReportSchema = z.object({
  /** Stable dotted id, e.g. `storage.bucket`. */
  id: z.string(),
  /** `core`, `auth`, `storage`, ... — a fork may add its own. */
  category: z.string(),
  /** Short human label: "Object storage bucket". */
  label: z.string(),
  /** The web route that fixes this check, when there is one. */
  settingsPath: z.string().nullable(),
  /** `pass`, `warn`, `fail` or `skip`. */
  status: doctorStatusSchema,
  /** One line: what was found. */
  detail: z.string(),
  /** What to do about a `warn` or `fail`. Always set on those two. */
  remedy: z.string().nullable(),
  /** The underlying error message, when a probe failed. */
  error: z.string().nullable(),
  /** Small scalar facts: counts, versions, latencies. Never secret material. */
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable(),
  /** How long this check took; 0 when it was skipped without running. */
  durationMs: z.number().int(),
});

/**
 * The whole report, as `GET /api/admin/doctor` returns it: `verdict` (the
 * worst status in `checks`, `skip` when none ran), `generatedAt` (ISO 8601; a
 * cached report keeps its original time), `durationMs` (wall time of the run)
 * and `checks` (sorted by category, configured order first, then registration
 * order).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const doctorReportSchema = z.object({
  /** The worst status in `checks` (`pass < skip < warn < fail`); `skip` when none ran. */
  verdict: doctorStatusSchema,
  /** When this report was produced. A cached report keeps its original time. */
  generatedAt: z.iso.datetime(),
  /** Wall time of the whole run. */
  durationMs: z.number().int(),
  /** Sorted by category (shipped order first), then registration order. */
  checks: z.array(doctorCheckReportSchema),
});

// The query's `'true' | 'false'` parameter, typed through its named entries.
const booleanStringSchema: z.ZodEnum<DoctorBooleanStringEnum> = z.enum(['true', 'false']);

/**
 * `GET /api/admin/doctor` query: `category` (a lowercase identifier; only the
 * checks in that category, plus, unreported, whatever they depend on) and
 * `refresh` (`'true'` bypasses the 15-second report cache).
 *
 * `refresh` is `z.enum(['true','false']).transform(...)` and NOT
 * `z.coerce.boolean()`: every query parameter is a string and
 * `Boolean('false')` is `true`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const doctorQuerySchema = z.object({
  /** Only the checks in this category (plus, unreported, whatever they depend on). */
  category: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'category must be a lowercase identifier')
    .optional(),
  /** `true` bypasses the 15-second report cache. */
  refresh: booleanStringSchema
    .transform((value) => value === 'true')
    .optional(),
});

/**
 * One row of the report. Every nullable field is present on every row.
 *
 * @stability stable
 */
export type DoctorCheckReport = z.infer<typeof doctorCheckReportSchema>;

/**
 * The whole report.
 *
 * @stability stable
 */
export type DoctorReport = z.infer<typeof doctorReportSchema>;

/**
 * The parsed query of `GET /api/admin/doctor` (`refresh` already a boolean).
 *
 * @stability stable
 */
export type DoctorQuery = z.output<typeof doctorQuerySchema>;

/**
 * The query a client builds before serializing it: restrict the run to one
 * `category`, or `refresh` to bypass the server-side cache.
 *
 * @stability stable
 */
export interface DoctorReportQueryInput {
  /** Restrict the run to one category (a lowercase identifier). */
  category?: string;
  /** Bypass the server-side report cache and run every probe again. */
  refresh?: boolean;
}

// Compile-time proofs: the wire enum holds exactly the statuses of
// constants.ts, and the client query is exactly the parsed query, so neither
// can drift from the other.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const statusEnumMatchesConstants: Same<z.infer<typeof doctorStatusSchema>, DoctorStatus> = true;
const queryInputMatchesSchema: Same<DoctorReportQueryInput, DoctorQuery> = true;
void statusEnumMatchesConstants;
void queryInputMatchesSchema;

// -----------------------------------------------------------------------------
// The support bundle (issue #772): the envelope `GET /api/admin/doctor/support-bundle`
// returns. Each section's `data` is validated by that section's own strict
// schema on the server (`@marinoscar/platform-api/doctor`), so here it stays
// `unknown`.
// -----------------------------------------------------------------------------

/**
 * One section of a bundle. `truncated: true` with `data: null` means the
 * section was larger than its size cap and its data was dropped.
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const supportBundleSectionResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    data: z.unknown().describe("The section's data, already validated by its strict schema and redacted."),
    truncated: z.boolean().optional().describe('`true` when a size cap dropped the data (`data` is then `null`).'),
  }),
  z.object({
    status: z.literal('omitted'),
    reason: z.string().describe('Why the section was not collected (a missing permission, a capability switched off).'),
  }),
  z.object({
    status: z.literal('error'),
    error: z.string().describe('One redacted line: a throw, a timeout or a schema violation. Never the raw value.'),
  }),
]);

/**
 * One section of a bundle, as parsed.
 *
 * @stability experimental
 */
export type SupportBundleSectionResult = z.infer<typeof supportBundleSectionResultSchema>;

/**
 * The support bundle: what `GET /api/admin/doctor/support-bundle` returns as a
 * JSON attachment.
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const supportBundleSchema = z.object({
  bundleVersion: z.literal(SUPPORT_BUNDLE_VERSION).describe('The bundle format version.'),
  generatedAt: z.string().describe('When the bundle was built (ISO 8601, UTC).'),
  redaction: z
    .object({
      rules: z.literal(SUPPORT_BUNDLE_REDACTION_RULES).describe('The redaction rule set applied.'),
      replacements: z.number().int().describe('How many values the redaction pass replaced.'),
    })
    .describe('The central redaction pass, applied on top of every section schema.'),
  sections: z
    .record(z.string(), supportBundleSectionResultSchema)
    .describe('One entry per registered section, keyed by section id.'),
});

/**
 * The support bundle, as parsed.
 *
 * @stability experimental
 */
export type SupportBundle = z.infer<typeof supportBundleSchema>;
