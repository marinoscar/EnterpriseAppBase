// =============================================================================
// A tiny SQL engine for the in-memory telemetry store (PP-14.11 example)
// =============================================================================
//
// Just enough SQL to run the telemetry dashboard's server-authored statements
// and a simple explorer query over rows held in memory. NOT a database and not
// meant to be one; an app with a real engine behind its store ignores this file.
//
// WHAT IT PARSES (one read-only statement):
//
//   query     SELECT [items] [FROM table | (query)] [WHERE e] [GROUP BY e, ...]
//             (UNION [ALL] SELECT ...)* [ORDER BY e [ASC|DESC], ...] [LIMIT n]
//   items     e [AS alias] | *
//   e         literals (number, 'text', NULL, TRUE, FALSE), "column", f(args),
//             CASE WHEN .. THEN .. [ELSE ..] END, (e), (query) as a scalar,
//             + - * /, = <> != < <= > >=, AND OR NOT, IS [NOT] NULL, LIKE
//   aggregate count(*), count(e), sum, min, max, avg, percentile_of(f, e)
//   scalar    bucket_start(seconds, ts), regex_replace_all(e, pattern, repl),
//             json_text(json, key), icontains(e, text), to_text(e), substr(e, from, len)
//
// The last block is this store's DIALECT (`memory-store.ts`): the platform asks
// the dialect for the spelling of the constructs it cannot write in portable
// SQL, so a store never has to parse `date_bin` or `approx_percentile_cont`.
//
// Timestamps are ISO-8601 strings (`2026-09-27T22:00:00.000Z`), which compare
// correctly as text. NULL follows SQL's three-valued logic and sorts as the
// largest value (as PostgreSQL does). Anything else is a TelemetryQueryFailedError
// naming what it did not understand, never a silent wrong answer.
// =============================================================================

import {
  TelemetryMultiStatementError,
  TelemetryQueryFailedError,
  type TelemetryField,
  type TelemetryQueryResult,
} from '@marinoscar/platform-api/telemetry';

/** One stored row: column name to value. */
export type MemoryRow = Record<string, unknown>;

/** The tables the engine reads. */
export interface MemoryTables {
  get(name: string): { columns: string[]; rows: MemoryRow[] } | undefined;
}

// ---- tokens ---------------------------------------------------------------------------

type Token = { t: 'num' | 'str' | 'id' | 'qid' | 'op' | 'end'; v: string };

const KEYWORDS = new Set([
  'select', 'from', 'where', 'group', 'by', 'order', 'asc', 'desc', 'limit', 'as', 'and', 'or', 'not', 'is', 'null',
  'true', 'false', 'case', 'when', 'then', 'else', 'end', 'like', 'union', 'all', 'distinct',
]);

function fail(message: string): never {
  throw new TelemetryQueryFailedError(`In-memory store: ${message}`, undefined, 'server');
}

function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") {
      let j = i + 1;
      let text = '';
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { text += "'"; j += 2; continue; }
        if (sql[j] === "'") break;
        text += sql[j++];
      }
      if (j >= sql.length) fail('unterminated string literal');
      out.push({ t: 'str', v: text });
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let text = '';
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') { text += '"'; j += 2; continue; }
        if (sql[j] === '"') break;
        text += sql[j++];
      }
      if (j >= sql.length) fail('unterminated quoted identifier');
      out.push({ t: 'qid', v: text });
      i = j + 1;
      continue;
    }
    const num = /^\d+(\.\d+)?/.exec(sql.slice(i));
    if (num) { out.push({ t: 'num', v: num[0] }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    const op = /^(<=|>=|<>|!=|[=<>+\-*/(),;.])/.exec(sql.slice(i));
    if (op) { out.push({ t: 'op', v: op[0] }); i += op[0].length; continue; }
    fail(`unexpected character ${JSON.stringify(c)}`);
  }
  out.push({ t: 'end', v: '' });
  return out;
}

// ---- syntax tree ------------------------------------------------------------------------

type Expr =
  | { k: 'lit'; v: unknown }
  | { k: 'col'; name: string }
  | { k: 'fn'; name: string; args: Expr[]; star: boolean }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'not'; e: Expr }
  | { k: 'isnull'; e: Expr; negate: boolean }
  | { k: 'case'; whens: { c: Expr; t: Expr }[]; otherwise: Expr | null }
  | { k: 'sub'; q: Compound };

interface Item {
  e: Expr | null;
  alias: string | null;
  star: boolean;
}

interface Select {
  items: Item[];
  from: { table: string } | { sub: Compound } | null;
  where: Expr | null;
  groupBy: Expr[];
}

interface Compound {
  parts: Select[];
  all: boolean[];
  orderBy: { e: Expr; desc: boolean }[];
  limit: number | null;
}

const AGGREGATES = new Set(['count', 'sum', 'min', 'max', 'avg', 'percentile_of']);

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private get cur(): Token {
    return this.tokens[this.pos];
  }

  private isKw(word: string): boolean {
    return this.cur.t === 'id' && this.cur.v.toLowerCase() === word;
  }

  private eatKw(word: string): boolean {
    if (!this.isKw(word)) return false;
    this.pos++;
    return true;
  }

  private expectKw(word: string): void {
    if (!this.eatKw(word)) fail(`expected ${word.toUpperCase()} near ${JSON.stringify(this.cur.v)}`);
  }

  private isOp(op: string): boolean {
    return this.cur.t === 'op' && this.cur.v === op;
  }

  private eatOp(op: string): boolean {
    if (!this.isOp(op)) return false;
    this.pos++;
    return true;
  }

  private expectOp(op: string): void {
    if (!this.eatOp(op)) fail(`expected "${op}" near ${JSON.stringify(this.cur.v)}`);
  }

  parseStatement(): Compound {
    if (!this.isKw('select')) {
      fail('only SELECT statements are supported (this store is read-only)');
    }
    const q = this.parseCompound();
    this.eatOp(';');
    if (this.cur.t !== 'end') {
      if (this.isKw('select')) throw new TelemetryMultiStatementError();
      fail(`unexpected ${JSON.stringify(this.cur.v)} after the statement`);
    }
    return q;
  }

  private parseCompound(): Compound {
    const parts: Select[] = [this.parseSelect()];
    const all: boolean[] = [];
    while (this.eatKw('union')) {
      all.push(this.eatKw('all'));
      parts.push(this.parseSelect());
    }
    const orderBy: Compound['orderBy'] = [];
    if (this.eatKw('order')) {
      this.expectKw('by');
      do {
        const e = this.parseExpr();
        const desc = this.eatKw('desc');
        if (!desc) this.eatKw('asc');
        orderBy.push({ e, desc });
      } while (this.eatOp(','));
    }
    let limit: number | null = null;
    if (this.eatKw('limit')) {
      if (this.cur.t !== 'num') fail('LIMIT needs a number');
      limit = Number(this.cur.v);
      this.pos++;
    }
    return { parts, all, orderBy, limit };
  }

  private parseSelect(): Select {
    this.expectKw('select');
    this.eatKw('distinct');
    const items: Item[] = [];
    do {
      if (this.eatOp('*')) {
        items.push({ e: null, alias: null, star: true });
        continue;
      }
      const e = this.parseExpr();
      let alias: string | null = null;
      if (this.eatKw('as')) alias = this.parseName();
      items.push({ e, alias, star: false });
    } while (this.eatOp(','));

    let from: Select['from'] = null;
    if (this.eatKw('from')) {
      if (this.eatOp('(')) {
        from = { sub: this.parseCompound() };
        this.expectOp(')');
        if (this.eatKw('as')) this.parseName();
      } else {
        from = { table: this.parseName() };
      }
    }
    const where = this.eatKw('where') ? this.parseExpr() : null;
    const groupBy: Expr[] = [];
    if (this.eatKw('group')) {
      this.expectKw('by');
      do groupBy.push(this.parseExpr());
      while (this.eatOp(','));
    }
    return { items, from, where, groupBy };
  }

  private parseName(): string {
    const token = this.cur;
    if (token.t === 'qid' || (token.t === 'id' && !KEYWORDS.has(token.v.toLowerCase()))) {
      this.pos++;
      return token.v;
    }
    return fail(`expected a name near ${JSON.stringify(token.v)}`);
  }

  // expression precedence: OR < AND < NOT < comparison < additive < multiplicative < primary
  parseExpr(): Expr {
    let left = this.parseAnd();
    while (this.eatKw('or')) left = { k: 'bin', op: 'or', l: left, r: this.parseAnd() };
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.eatKw('and')) left = { k: 'bin', op: 'and', l: left, r: this.parseNot() };
    return left;
  }

  private parseNot(): Expr {
    if (this.eatKw('not')) return { k: 'not', e: this.parseNot() };
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    const left = this.parseAdditive();
    if (this.eatKw('is')) {
      const negate = this.eatKw('not');
      this.expectKw('null');
      return { k: 'isnull', e: left, negate };
    }
    if (this.eatKw('like')) return { k: 'bin', op: 'like', l: left, r: this.parseAdditive() };
    for (const op of ['<=', '>=', '<>', '!=', '=', '<', '>']) {
      if (this.eatOp(op)) return { k: 'bin', op: op === '!=' ? '<>' : op, l: left, r: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    for (;;) {
      if (this.eatOp('+')) left = { k: 'bin', op: '+', l: left, r: this.parseMultiplicative() };
      else if (this.eatOp('-')) left = { k: 'bin', op: '-', l: left, r: this.parseMultiplicative() };
      else return left;
    }
  }

  private parseMultiplicative(): Expr {
    let left = this.parsePrimary();
    for (;;) {
      if (this.eatOp('*')) left = { k: 'bin', op: '*', l: left, r: this.parsePrimary() };
      else if (this.eatOp('/')) left = { k: 'bin', op: '/', l: left, r: this.parsePrimary() };
      else return left;
    }
  }

  private parsePrimary(): Expr {
    const token = this.cur;
    if (token.t === 'num') { this.pos++; return { k: 'lit', v: Number(token.v) }; }
    if (token.t === 'str') { this.pos++; return { k: 'lit', v: token.v }; }
    if (this.eatOp('(')) {
      if (this.isKw('select')) {
        const q = this.parseCompound();
        this.expectOp(')');
        return { k: 'sub', q };
      }
      const e = this.parseExpr();
      this.expectOp(')');
      return e;
    }
    if (this.isOp('-')) { this.pos++; return { k: 'bin', op: '-', l: { k: 'lit', v: 0 }, r: this.parsePrimary() }; }
    if (token.t === 'qid') { this.pos++; return { k: 'col', name: token.v }; }
    if (token.t === 'id') {
      const word = token.v.toLowerCase();
      if (word === 'null') { this.pos++; return { k: 'lit', v: null }; }
      if (word === 'true') { this.pos++; return { k: 'lit', v: true }; }
      if (word === 'false') { this.pos++; return { k: 'lit', v: false }; }
      if (word === 'case') return this.parseCase();
      this.pos++;
      if (this.eatOp('(')) {
        if (this.eatOp('*')) {
          this.expectOp(')');
          return { k: 'fn', name: word, args: [], star: true };
        }
        const args: Expr[] = [];
        if (!this.isOp(')')) {
          do args.push(this.parseExpr());
          while (this.eatOp(','));
        }
        this.expectOp(')');
        return { k: 'fn', name: word, args, star: false };
      }
      if (KEYWORDS.has(word)) fail(`unexpected keyword ${token.v.toUpperCase()}`);
      return { k: 'col', name: token.v };
    }
    return fail(`unexpected ${token.t === 'end' ? 'end of statement' : JSON.stringify(token.v)}`);
  }

  private parseCase(): Expr {
    this.expectKw('case');
    const whens: { c: Expr; t: Expr }[] = [];
    while (this.eatKw('when')) {
      const c = this.parseExpr();
      this.expectKw('then');
      whens.push({ c, t: this.parseExpr() });
    }
    const otherwise = this.eatKw('else') ? this.parseExpr() : null;
    this.expectKw('end');
    return { k: 'case', whens, otherwise };
  }
}

// ---- evaluation ---------------------------------------------------------------------------

type Env = Record<string, unknown>;

interface Relation {
  names: string[];
  rows: { values: unknown[]; env: Env }[];
}

/** NULL is the largest value, so it sorts last ascending and first descending. */
function compareValues(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function isTrue(value: unknown): boolean {
  return value === true;
}

function containsAggregate(e: Expr): boolean {
  switch (e.k) {
    case 'fn': return AGGREGATES.has(e.name) || e.args.some(containsAggregate);
    case 'bin': return containsAggregate(e.l) || containsAggregate(e.r);
    case 'not': return containsAggregate(e.e);
    case 'isnull': return containsAggregate(e.e);
    case 'case': return e.whens.some((w) => containsAggregate(w.c) || containsAggregate(w.t)) || (e.otherwise !== null && containsAggregate(e.otherwise));
    default: return false;
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function describeExpr(e: Expr): string {
  return e.k === 'col' ? e.name : e.k === 'fn' ? e.name : '?column?';
}

class Engine {
  constructor(private readonly tables: MemoryTables) {}

  run(query: Compound): Relation {
    const results = query.parts.map((part) => this.runSelect(part));
    let relation = results[0];
    for (let i = 1; i < results.length; i++) {
      if (results[i].names.length !== relation.names.length) fail('UNION parts must select the same number of columns');
      const merged = [...relation.rows, ...results[i].rows];
      relation = {
        names: relation.names,
        rows: query.all[i - 1]
          ? merged
          : merged.filter((row, index) => merged.findIndex((other) => JSON.stringify(other.values) === JSON.stringify(row.values)) === index),
      };
    }

    if (query.orderBy.length > 0) {
      const keyed = relation.rows.map((row) => ({
        row,
        keys: query.orderBy.map((o) => this.evaluate(o.e, { ...row.env, ...Object.fromEntries(relation.names.map((n, i) => [n, row.values[i]])) })),
      }));
      keyed.sort((a, b) => {
        for (let i = 0; i < query.orderBy.length; i++) {
          const c = compareValues(a.keys[i], b.keys[i]);
          if (c !== 0) return query.orderBy[i].desc ? -c : c;
        }
        return 0;
      });
      relation = { names: relation.names, rows: keyed.map((k) => k.row) };
    }
    if (query.limit !== null) relation = { names: relation.names, rows: relation.rows.slice(0, query.limit) };
    return relation;
  }

  private source(select: Select): { columns: string[]; rows: Env[] } {
    if (select.from === null) return { columns: [], rows: [{}] };
    if ('table' in select.from) {
      const table = this.tables.get(select.from.table);
      if (!table) fail(`table "${select.from.table}" does not exist`);
      return { columns: table.columns, rows: table.rows };
    }
    const sub = this.run(select.from.sub);
    return { columns: sub.names, rows: sub.rows.map((r) => Object.fromEntries(sub.names.map((n, i) => [n, r.values[i]]))) };
  }

  private runSelect(select: Select): Relation {
    const source = this.source(select);
    const filtered = select.where ? source.rows.filter((row) => isTrue(this.evaluate(select.where!, row))) : source.rows;

    const items: Item[] = select.items.flatMap((item) =>
      item.star ? source.columns.map((c) => ({ e: { k: 'col', name: c } as Expr, alias: c, star: false })) : [item],
    );
    const names = items.map((item) => item.alias ?? describeExpr(item.e!));
    const aggregated = select.groupBy.length > 0 || items.some((item) => containsAggregate(item.e!));

    if (!aggregated) {
      return {
        names,
        rows: filtered.map((row) => ({ values: items.map((item) => this.evaluate(item.e!, row)), env: row })),
      };
    }

    // GROUP BY may name a select alias (`GROUP BY t`) or a column.
    const aliasExpr = new Map(items.filter((i) => i.alias).map((i) => [i.alias!, i.e!]));
    const keyOf = (row: Env) =>
      select.groupBy.map((g) => this.evaluate(g.k === 'col' && !(g.name in row) && aliasExpr.has(g.name) ? aliasExpr.get(g.name)! : g, row));
    const groups = new Map<string, Env[]>();
    for (const row of filtered) {
      const key = JSON.stringify(keyOf(row));
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }
    if (select.groupBy.length === 0 && groups.size === 0) groups.set('[]', []);

    return {
      names,
      rows: [...groups.values()].map((rows) => {
        const env = rows[0] ?? {};
        return { values: items.map((item) => this.evaluate(item.e!, env, rows)), env };
      }),
    };
  }

  evaluate(e: Expr, env: Env, group?: Env[]): unknown {
    switch (e.k) {
      case 'lit': return e.v;
      case 'col':
        if (!(e.name in env)) fail(`column "${e.name}" does not exist`);
        return env[e.name] ?? null;
      case 'not': {
        const v = this.evaluate(e.e, env, group);
        return v === null ? null : !isTrue(v);
      }
      case 'isnull': {
        const v = this.evaluate(e.e, env, group);
        return e.negate ? v !== null && v !== undefined : v === null || v === undefined;
      }
      case 'case': {
        for (const w of e.whens) if (isTrue(this.evaluate(w.c, env, group))) return this.evaluate(w.t, env, group);
        return e.otherwise ? this.evaluate(e.otherwise, env, group) : null;
      }
      case 'sub': {
        const result = this.run(e.q);
        return result.rows[0]?.values[0] ?? null;
      }
      case 'bin': return this.binary(e, env, group);
      case 'fn': return AGGREGATES.has(e.name) ? this.aggregate(e, group) : this.scalar(e, env, group);
    }
  }

  private binary(e: Extract<Expr, { k: 'bin' }>, env: Env, group?: Env[]): unknown {
    if (e.op === 'and' || e.op === 'or') {
      const l = this.evaluate(e.l, env, group);
      const r = this.evaluate(e.r, env, group);
      if (e.op === 'and') return l === false || r === false ? false : l === null || r === null ? null : true;
      return l === true || r === true ? true : l === null || r === null ? null : false;
    }
    const l = this.evaluate(e.l, env, group);
    const r = this.evaluate(e.r, env, group);
    if (l === null || l === undefined || r === null || r === undefined) return null;
    switch (e.op) {
      case '+': case '-': case '*': case '/': {
        const x = toNumber(l);
        const y = toNumber(r);
        if (x === null || y === null) return null;
        return e.op === '+' ? x + y : e.op === '-' ? x - y : e.op === '*' ? x * y : y === 0 ? null : x / y;
      }
      case 'like': {
        const pattern = String(r).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
        return new RegExp(`^${pattern}$`, 's').test(String(l));
      }
      default: {
        const c = typeof l === 'number' && typeof r === 'number' ? l - r : typeof l === 'boolean' || typeof r === 'boolean' ? (l === r ? 0 : 1) : compareValues(l, r);
        switch (e.op) {
          case '=': return c === 0;
          case '<>': return c !== 0;
          case '<': return c < 0;
          case '<=': return c <= 0;
          case '>': return c > 0;
          case '>=': return c >= 0;
        }
        return fail(`unsupported operator ${e.op}`);
      }
    }
  }

  private aggregate(e: Extract<Expr, { k: 'fn' }>, group?: Env[]): unknown {
    if (!group) fail(`${e.name}() is an aggregate and needs a GROUP BY context`);
    if (e.name === 'count' && e.star) return group.length;
    const arg = e.name === 'percentile_of' ? e.args[1] : e.args[0];
    if (!arg) fail(`${e.name}() needs an argument`);
    const values = group.map((row) => this.evaluate(arg, row)).filter((v) => v !== null && v !== undefined);
    switch (e.name) {
      case 'count': return values.length;
      case 'sum': {
        const numbers = values.map(toNumber).filter((n): n is number => n !== null);
        return numbers.length ? numbers.reduce((a, b) => a + b, 0) : null;
      }
      case 'avg': {
        const numbers = values.map(toNumber).filter((n): n is number => n !== null);
        return numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null;
      }
      case 'min': return values.length ? values.reduce((a, b) => (compareValues(a, b) <= 0 ? a : b)) : null;
      case 'max': return values.length ? values.reduce((a, b) => (compareValues(a, b) >= 0 ? a : b)) : null;
      case 'percentile_of': {
        const fraction = toNumber(this.evaluate(e.args[0], {}));
        const numbers = values.map(toNumber).filter((n): n is number => n !== null).sort((a, b) => a - b);
        if (fraction === null || numbers.length === 0) return null;
        return numbers[Math.min(numbers.length - 1, Math.max(0, Math.ceil(fraction * numbers.length) - 1))];
      }
    }
    return fail(`unsupported aggregate ${e.name}`);
  }

  private scalar(e: Extract<Expr, { k: 'fn' }>, env: Env, group?: Env[]): unknown {
    const args = e.args.map((a) => this.evaluate(a, env, group));
    const nil = args.some((a) => a === null || a === undefined);
    switch (e.name) {
      case 'bucket_start': {
        const seconds = toNumber(args[0]);
        const at = args[1] === null || args[1] === undefined ? NaN : Date.parse(String(args[1]));
        if (seconds === null || Number.isNaN(at)) return null;
        const width = seconds * 1000;
        return new Date(Math.floor(at / width) * width).toISOString();
      }
      case 'regex_replace_all':
        return nil ? null : String(args[0]).replace(new RegExp(String(args[1]), 'g'), String(args[2]));
      case 'json_text': {
        if (nil) return null;
        try {
          const parsed = typeof args[0] === 'string' ? JSON.parse(args[0]) : args[0];
          const value = (parsed as Record<string, unknown> | null)?.[String(args[1])];
          return typeof value === 'string' ? value : value === undefined || value === null ? null : String(value);
        } catch {
          return null;
        }
      }
      case 'icontains':
        return nil ? null : String(args[0]).toLowerCase().includes(String(args[1]).toLowerCase());
      case 'to_text':
        return args[0] === null || args[0] === undefined ? null : String(args[0]);
      case 'substr': {
        if (nil) return null;
        const from = Math.max(1, toNumber(args[1]) ?? 1);
        const length = args[2] === undefined ? undefined : (toNumber(args[2]) ?? 0);
        const text = String(args[0]);
        return length === undefined ? text.slice(from - 1) : text.slice(from - 1, from - 1 + length);
      }
    }
    return fail(`unknown function ${e.name}()`);
  }
}

// ---- result typing --------------------------------------------------------------------------

/** The PostgreSQL type OID the explorer shows for a result column, from its first non-null value. */
function oidOf(values: unknown[]): number {
  const sample = values.find((v) => v !== null && v !== undefined);
  if (typeof sample === 'boolean') return 16;
  if (typeof sample === 'number') return Number.isInteger(sample) ? 20 : 701;
  return 25;
}

/**
 * Runs one statement over `tables`.
 *
 * @param sql - one read-only statement (see the header for the subset).
 * @param tables - the rows.
 * @returns the result in the store port's positional shape.
 * @throws TelemetryQueryFailedError for a statement outside the subset or a column or table that does not exist.
 * @throws TelemetryMultiStatementError for more than one statement.
 */
export function runMemorySql(sql: string, tables: MemoryTables): TelemetryQueryResult {
  const query = new Parser(tokenize(sql)).parseStatement();
  const relation = new Engine(tables).run(query);
  const fields: TelemetryField[] = relation.names.map((name, index) => ({
    name,
    dataTypeID: oidOf(relation.rows.map((row) => row.values[index])),
  }));

  return { fields, rows: relation.rows.map((row) => row.values) };
}
