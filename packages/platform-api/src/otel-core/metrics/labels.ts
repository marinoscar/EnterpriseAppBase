// =============================================================================
// Label bounding (issue #600; packaged by issue #700)
// =============================================================================
//
// Attributes become GreptimeDB columns and series, so every label is bounded:
// job type, status/outcome, executor, provider, model, operation, channel and
// event key, NEVER a user id, an email, a URL or an error message. A
// free-form string must look like an identifier (at most 64 characters of
// `[A-Za-z0-9_.:/@+-]`, never address-shaped), and each attribute key admits
// at most `MAX_DISTINCT_VALUES` distinct values per process; anything else
// becomes `other`. Enumerated attributes (outcomes) are checked against their
// allowed set and fall back to `other` too.
// =============================================================================

/**
 * Per attribute key, how many distinct free-form values are admitted before
 * `other`, per process.
 *
 * @stability stable
 */
export const MAX_DISTINCT_VALUES = 100;

/** The longest free-form label kept as is. */
const MAX_LABEL_LENGTH = 64;
const LABEL_PATTERN = /^[A-Za-z0-9_.:/@+-]+$/;
/** `@` is allowed for versioned model ids (`model@20240620`), never for an address. */
const EMAIL_LIKE = /@[^@]*\./;

/**
 * The label a value outside its bound (shape, budget or enum) is exported as.
 *
 * @stability stable
 */
export const OTHER_LABEL = 'other';

/**
 * The label an empty or missing value is exported as.
 *
 * @stability stable
 */
export const UNKNOWN_LABEL = 'unknown';

/**
 * The SHAPE half of `MetricsHostService.boundLabel`, with no distinct-value
 * budget: `unknown` when empty, `other` when the value is not
 * identifier-shaped (at most 64 characters of `[A-Za-z0-9_.:/@+-]`, never
 * address-shaped), else the trimmed value. For a label that is functionally
 * dependent on another, already-bounded one (a node's name beside its capped
 * `node_id`), where a per-process budget would only fold real values into
 * `other` without bounding anything.
 *
 * @param value - Any value; non-strings are `unknown`.
 * @returns The trimmed value, `other` or `unknown`.
 *
 * @stability stable
 */
export function shapeLabel(value: unknown): string {
  if (typeof value !== 'string') return UNKNOWN_LABEL;
  const trimmed = value.trim();
  if (trimmed.length === 0) return UNKNOWN_LABEL;
  if (trimmed.length > MAX_LABEL_LENGTH || !LABEL_PATTERN.test(trimmed) || EMAIL_LIKE.test(trimmed)) {
    return OTHER_LABEL;
  }
  return trimmed;
}

/**
 * An enumerated value, or `other`.
 *
 * @param value - The value to check.
 * @param allowed - The values the attribute admits.
 * @returns `value` when it is one of `allowed`, else `other`.
 *
 * @stability stable
 */
export function enumLabel(value: unknown, allowed: ReadonlySet<string>): string {
  return typeof value === 'string' && allowed.has(value) ? value : OTHER_LABEL;
}

/**
 * A non-negative finite number, or `null`: what a counter, histogram or
 * duration accepts.
 *
 * @param value - The value to check.
 * @returns `value`, or `null` when it is not a non-negative finite number.
 *
 * @stability stable
 */
export function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Per-key distinct-value budgets: the stateful half of label bounding.
 *
 * @stability experimental
 */
export class LabelBudget {
  /** Distinct free-form values admitted so far, per attribute key. */
  private readonly seen = new Map<string, Set<string>>();

  /**
   * @param maxDistinct - Distinct values admitted per key before `other`.
   */
  constructor(private readonly maxDistinct: number = MAX_DISTINCT_VALUES) {}

  /**
   * A free-form string as a low-cardinality label: `unknown` when empty,
   * `other` when it does not look like an identifier, is too long, or would
   * be the `maxDistinct + 1`-th distinct value for `key`.
   *
   * @param key - The budget to charge (usually the attribute key).
   * @param value - The raw value.
   * @returns The bounded label.
   */
  bound(key: string, value: unknown): string {
    const trimmed = shapeLabel(value);
    if (trimmed === UNKNOWN_LABEL || trimmed === OTHER_LABEL) return trimmed;

    let seen = this.seen.get(key);
    if (!seen) {
      seen = new Set();
      this.seen.set(key, seen);
    }
    if (seen.has(trimmed)) return trimmed;
    if (seen.size >= this.maxDistinct) return OTHER_LABEL;
    seen.add(trimmed);
    return trimmed;
  }
}
