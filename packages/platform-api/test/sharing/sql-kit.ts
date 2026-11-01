// A minimal stand-in for the app's `Prisma` SQL helpers (issue #729), so the
// package's specs never load Prisma. Same shape as `Prisma.sql`/`join`/`raw`/
// `empty`: nested fragments are flattened, every other value is a bind
// parameter, and `text` numbers them `$1..$n` as PostgreSQL sees them. Not a
// spec.

import type { SqlKit } from '../../src/sharing/index';

export class FakeSql {
  readonly strings: string[];
  readonly values: unknown[];

  constructor(strings: readonly string[], values: readonly unknown[]) {
    const outStrings: string[] = [strings[0] ?? ''];
    const outValues: unknown[] = [];
    values.forEach((value, i) => {
      const next = strings[i + 1] ?? '';
      if (value instanceof FakeSql) {
        outStrings[outStrings.length - 1] += value.strings[0];
        outValues.push(...value.values);
        outStrings.push(...value.strings.slice(1));
        outStrings[outStrings.length - 1] += next;
      } else {
        outValues.push(value);
        outStrings.push(next);
      }
    });
    this.strings = outStrings;
    this.values = outValues;
  }

  /** The statement as PostgreSQL receives it. */
  get text(): string {
    return this.strings.reduce((out, part, i) => (i === 0 ? part : `${out}$${i}${part}`), '');
  }
}

export const fakeSqlKit: SqlKit<FakeSql> = {
  sql: (strings, ...values) => new FakeSql(strings, values),
  join: (values, separator = ',') =>
    new FakeSql(
      values.length === 0 ? [''] : ['', ...values.slice(1).map(() => separator), ''],
      values,
    ),
  raw: (text) => new FakeSql([text], []),
  empty: new FakeSql([''], []),
};
