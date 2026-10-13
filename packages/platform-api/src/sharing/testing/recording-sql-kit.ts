// =============================================================================
// A recording SQL kit (PP-14.16): proves a fragment is parameterised
// =============================================================================
//
// `SqlKit<S>` is how the slice builds SQL without importing Prisma. This kit
// builds no query: it RECORDS the literal text of a fragment, with a `?` for
// every bound value, the values themselves and the `raw()` texts. A
// conformance kit builds a fragment from a principal full of hostile strings
// and asserts none of them reached the literal text: they may only appear in
// `values`.
// =============================================================================

import type { SqlKit } from '../access/accessible';

/**
 * One recorded fragment.
 *
 * @stability experimental
 */
export interface RecordedSql {
  /** Marks the object as a recording. */
  readonly recorded: true;
  /** The SQL text with `?` for every bound value (raw texts inline). */
  readonly text: string;
  /** The bound values, in order. */
  readonly values: readonly unknown[];
  /** Every text passed to `raw()`. */
  readonly raws: readonly string[];
}

function isRecorded(value: unknown): value is RecordedSql {
  return typeof value === 'object' && value !== null && (value as { recorded?: unknown }).recorded === true;
}

function piece(value: unknown): RecordedSql {
  return isRecorded(value) ? value : { recorded: true, text: '?', values: [value], raws: [] };
}

function concat(parts: readonly RecordedSql[], separator: string): RecordedSql {
  return {
    recorded: true,
    text: parts.map((part) => part.text).join(separator),
    values: parts.flatMap((part) => part.values),
    raws: parts.flatMap((part) => part.raws),
  };
}

/**
 * The recording kit: `sql` and `join` splice nested recordings and bind
 * everything else; `raw` records its text.
 *
 * @stability experimental
 */
export const recordingSqlKit: SqlKit<RecordedSql> = {
  sql(strings, ...values) {
    const parts: RecordedSql[] = [];
    strings.forEach((literal, index) => {
      parts.push({ recorded: true, text: literal, values: [], raws: [] });
      if (index < values.length) parts.push(piece(values[index]));
    });
    return concat(parts, '');
  },
  join(values, separator = ', ') {
    return concat(values.map(piece), separator);
  },
  raw: (text) => ({ recorded: true, text, values: [], raws: [text] }),
  empty: { recorded: true, text: '', values: [], raws: [] },
};
