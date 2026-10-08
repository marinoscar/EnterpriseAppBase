// An in-memory stand-in for the app's Prisma client, just wide enough for the
// user-data slice's statements: equality, `not`, `in`, `notIn`, `gt`,
// `startsWith`, `AND`/`OR`/`NOT`, and relation `none` (always true here, so a
// test asserts the WHERE it was given through `calls`).

export type Row = Record<string, any>;

export interface FakeDb {
  tables: Record<string, Row[]>;
  calls: { delegate: string; op: string; args: any }[];
  client: any;
  runAsSystem: <R>(reason: string, fn: (tx: any) => Promise<R>, options?: { timeout?: number }) => Promise<R>;
  system: (reason: string) => any;
}

function matchValue(value: any, cond: any): boolean {
  if (cond === null || typeof cond !== 'object' || cond instanceof Date) return value === cond;
  if ('none' in cond) return true;
  if ('equals' in cond) return typeof value === 'string' && cond.mode === 'insensitive' ? value.toLowerCase() === String(cond.equals).toLowerCase() : value === cond.equals;
  if ('not' in cond && !matchValue(value, cond.not)) return true;
  if ('not' in cond) return false;
  if ('in' in cond) return cond.in.includes(value);
  if ('notIn' in cond) return !cond.notIn.includes(value);
  if ('gt' in cond) return value > cond.gt;
  if ('startsWith' in cond) return typeof value === 'string' && value.startsWith(cond.startsWith);
  return false;
}

export function matches(row: Row, where: any = {}): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    if (key === 'AND') {
      if (!(cond as any[]).every((w) => matches(row, w))) return false;
    } else if (key === 'OR') {
      if (!(cond as any[]).some((w) => matches(row, w))) return false;
    } else if (key === 'NOT') {
      const list = Array.isArray(cond) ? cond : [cond];
      if (list.some((w) => matches(row, w))) return false;
    } else if (!matchValue(row[key], cond)) return false;
  }
  return true;
}

function pick(row: Row, select?: Record<string, boolean>): Row {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
}

export function createFakeDb(initial: Record<string, Row[]>, failOn?: (delegate: string, op: string, args: any) => boolean): FakeDb {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(initial).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));
  const calls: FakeDb['calls'] = [];
  const delegate = (name: string) => {
    tables[name] ??= [];
    const log = (op: string, args: any) => {
      calls.push({ delegate: name, op, args });
      if (failOn?.(name, op, args)) throw new Error(`fake failure on ${name}.${op}`);
    };
    return {
      async findMany(args: any = {}) {
        log('findMany', args);
        let rows = tables[name]!.filter((row) => matches(row, args.where));
        if (args.orderBy?.id === 'asc') rows = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
        if (args.take) rows = rows.slice(0, args.take);
        return rows.map((row) => pick(row, args.select));
      },
      async findUnique(args: any) {
        log('findUnique', args);
        const row = tables[name]!.find((r) => matches(r, args.where));
        return row ? pick(row, args.select) : null;
      },
      async findFirst(args: any = {}) {
        log('findFirst', args);
        const row = tables[name]!.find((r) => matches(r, args.where));
        return row ? pick(row, args.select) : null;
      },
      async count(args: any = {}) {
        log('count', args);
        return tables[name]!.filter((row) => matches(row, args.where)).length;
      },
      async aggregate(args: any) {
        log('aggregate', args);
        const rows = tables[name]!.filter((row) => matches(row, args.where));
        return { _sum: { size: rows.reduce((sum, row) => sum + Number(row.size ?? 0), 0) } };
      },
      async deleteMany(args: any = {}) {
        log('deleteMany', args);
        const before = tables[name]!.length;
        tables[name] = tables[name]!.filter((row) => !matches(row, args.where));
        return { count: before - tables[name]!.length };
      },
      async updateMany(args: any) {
        log('updateMany', args);
        let count = 0;
        for (const row of tables[name]!) if (matches(row, args.where)) (Object.assign(row, args.data), (count += 1));
        return { count };
      },
      async update(args: any) {
        log('update', args);
        const row = tables[name]!.find((r) => matches(r, args.where));
        if (!row) throw new Error(`${name}.update: no row`);
        Object.assign(row, args.data);
        return { ...row };
      },
      async upsert(args: any) {
        log('upsert', args);
        const key = Object.values(args.where)[0] as Row;
        const row = tables[name]!.find((r) => matches(r, key));
        if (row) Object.assign(row, args.update);
        else tables[name]!.push({ id: `${name}-${tables[name]!.length + 1}`, ...args.create });
        return {};
      },
    };
  };
  const client: any = new Proxy({}, { get: (_t, prop: string) => (prop in tables ? delegate(prop) : undefined) });
  return {
    tables,
    calls,
    client,
    runAsSystem: async (_reason, fn) => fn(client),
    system: () => client,
  };
}
