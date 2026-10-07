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
