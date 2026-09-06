// =============================================================================
// Job type display labels (issue #259, epic #254)
// =============================================================================
//
// A `Job.type` is a machine key (`'example.echo'`), chosen for dispatch and
// for stability across renames. The admin dashboard shows it to a person, and
// a person reading a queue at 2am should see a phrase, not a dotted
// identifier. This file is the one map between the two.
//
// -----------------------------------------------------------------------------
// A MAP PLUS A FALLBACK, NOT A REQUIRED FIELD ON `JobHandler`
// -----------------------------------------------------------------------------
//
// The obvious alternative is a `readonly label: string` on the handler
// interface, so a type cannot exist without a label. Rejected: it makes the
// contract bigger for a presentation concern, and the contract's smallness is
// the thing epic #254 is actually selling ("one class, no queue wiring"). The
// interface's job is to be the minimum a worker needs to run a job; nothing a
// worker does requires a display string.
//
// -----------------------------------------------------------------------------
// AN UNMAPPED TYPE RENDERS AS ITSELF, NEVER BLANK
// -----------------------------------------------------------------------------
//
// THIS IS THE POINT OF THE HELPER BELOW. A fork adds handlers this repository
// has never heard of — that is the whole promise — so this map is
// structurally incomplete at all times, and a lookup that returned
// `undefined` would render an empty cell in the dashboard for exactly the
// types a fork cares most about. Falling back to the raw type string means an
// unlabelled type is merely less pretty ("my-feature.do-the-thing") rather
// than invisible, and adding a label stays optional polish instead of a step
// a fork can forget and be punished for.
//
// A second reason the fallback is not optional: a `jobs` row can name a type
// no handler registers any more (rows outlive handlers — see the `Job` model
// comment). The dashboard still has to render that historical row.
// =============================================================================

/**
 * Display labels for the job types this repository ships.
 *
 * A fork adds its own entries here. Keys are `Job.type` values; values are
 * short human phrases in sentence case, sized for a table cell.
 *
 * Deliberately NOT exhaustive over anything — see the header: an unmapped
 * type is a supported, expected state, not a bug.
 */
export const JOB_TYPE_LABELS: Readonly<Record<string, string>> = {
  // The template's demonstration handler
  // (`handlers/example-echo.handler.ts`). Delete the handler and you may
  // delete this line; neither is load-bearing.
  'example.echo': 'Example echo',
  // The queue's own housekeeping (`handlers/job-history-purge.handler.ts`,
  // #263) — the first real job type this template ships, and one a fork
  // should keep: deleting it stops history being trimmed.
  'job.history.purge': 'Job history purge',
};

/**
 * The display label for `type`, falling back to `type` itself.
 *
 * Total by construction: every string in, a non-empty string out. Callers
 * never have to write their own `?? type`, which is what keeps the fallback
 * from being applied in some views and forgotten in others.
 */
export function jobTypeLabel(type: string): string {
  return JOB_TYPE_LABELS[type] ?? type;
}
