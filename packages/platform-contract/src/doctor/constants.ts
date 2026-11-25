// The Doctor's plain values (issue #701). Zod-free by rule: a browser that only
// needs a status list or a type never pulls the schemas, and with them zod,
// into its bundle (test/no-zod-in-constants.test.ts).

/**
 * Every status of a Doctor check, in severity order, lowest first
 * (`pass < skip < warn < fail`). Also the display order of the web page.
 *
 * - `pass`: verified healthy.
 * - `skip`: not evaluated (a check it depends on did not pass, or the
 *   capability is intentionally switched off).
 * - `warn`: works, but needs attention.
 * - `fail`: broken.
 *
 * @stability stable
 */
export const DOCTOR_STATUSES = ['pass', 'skip', 'warn', 'fail'] as const;

/**
 * The four outcomes of a check, identical to the CLI doctor's `CheckStatus`:
 * `pass`, `warn`, `fail` or `skip`.
 *
 * @stability stable
 */
export type DoctorStatus = (typeof DOCTOR_STATUSES)[number];

/**
 * How bad a status is, for a report's overall verdict: the worst wins.
 *
 * `skip` ranks just above `pass`: a report whose only non-pass entries are
 * intentional skips (AI off, telemetry off) is healthy, but it proved less than
 * an all-pass one, and a report where nothing ran must not read as `pass`.
 *
 * @stability stable
 */
export const DOCTOR_STATUS_RANK: Readonly<Record<DoctorStatus, number>> = {
  pass: 0,
  skip: 1,
  warn: 2,
  fail: 3,
};

/**
 * The version of the support bundle format (`GET /api/admin/doctor/support-bundle`,
 * issue #772). Bumped only by a breaking change to `supportBundleSchema`.
 *
 * @stability experimental
 */
export const SUPPORT_BUNDLE_VERSION = 1 as const;

/**
 * The redaction rule set applied to every support bundle. `v1` is documented
 * in docs/specs/doctor.md ("Support bundle").
 *
 * @stability experimental
 */
export const SUPPORT_BUNDLE_REDACTION_RULES = 'v1' as const;

/**
 * The statuses of one support-bundle section: `ok` (collected), `omitted` (not
 * collected: a permission is missing or the capability is off) and `error`
 * (the section threw, timed out or broke its schema; its data is dropped).
 *
 * @stability experimental
 */
export const SUPPORT_BUNDLE_SECTION_STATUSES = ['ok', 'omitted', 'error'] as const;

/**
 * One support-bundle section's status.
 *
 * @stability experimental
 */
export type SupportBundleSectionStatus = (typeof SUPPORT_BUNDLE_SECTION_STATUSES)[number];
