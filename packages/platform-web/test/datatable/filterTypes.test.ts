/**
 * The open filter vocabulary (PP-14.20): the registry, the five built-ins that
 * go through it, a custom type, per-column operators, URL coercion and the
 * client-side matching helpers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OPERATORS_BY_FILTER_TYPE,
  columnOperatorLabel,
  filterChipLabel,
  getDataTableFilterType,
  isFilterableColumn,
  isFilterComplete,
  listDataTableFilterTypes,
  matchesFilterValue,
  matchesFilters,
  operatorArity,
  operatorLabel,
  operatorsForColumn,
  readDataTableUrlState,
  registerDataTableFilterType,
  writeDataTableUrlState,
  draftFilterFor,
  type DataTableColumn,
  type DataTableFilterTypeDef,
} from '../../src/datatable/headless/index.js';

interface Row {
  id: string;
  tags: string[];
  name: string;
  n: number;
  day: string;
  state: string;
  on: boolean;
}

const tagsType = (over: Partial<DataTableFilterTypeDef> = {}): DataTableFilterTypeDef => ({
  type: 'tags',
  operators: [
    { id: 'hasAny', label: 'has any of', arity: 'many' },
    { id: 'hasAll', label: 'has all of', arity: 'many' },
  ],
  matches: (value, operator, operand) => {
    const have = String(value ?? '').split(',').filter(Boolean);
    const want = (Array.isArray(operand) ? operand : []).map(String);
    return operator === 'hasAll' ? want.every((tag) => have.includes(tag)) : want.some((tag) => have.includes(tag));
  },
  ...over,
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.restoreAllMocks();
});
const register = (def: DataTableFilterTypeDef) => {
  const off = registerDataTableFilterType(def);
  cleanups.push(off);
  return off;
};

describe('the five built-ins go through the registry', () => {
  it('registers text, number, date, enum and boolean with their historical operators', () => {
    expect(listDataTableFilterTypes().map((d) => d.type).slice(0, 5)).toEqual(['text', 'number', 'date', 'enum', 'boolean']);
    expect(OPERATORS_BY_FILTER_TYPE).toEqual({
      text: ['contains', 'equals', 'startsWith', 'isEmpty'],
      number: ['equals', 'gt', 'lt', 'between'],
      date: ['before', 'after', 'between'],
      enum: ['is', 'isNot', 'isAnyOf'],
      boolean: ['is'],
    });
  });

  it('keeps the labels, including the number glyphs and the pinned-only operators', () => {
    expect(operatorLabel('equals', 'number')).toBe('=');
    expect(operatorLabel('gte', 'number')).toBe('≥');
    expect(operatorLabel('lte', 'number')).toBe('≤');
    expect(operatorLabel('equals', 'text')).toBe('equals');
    expect(operatorLabel('between', 'number')).toBe('is between');
    expect(operatorLabel('in', 'enum')).toBe('is any of');
    expect(operatorLabel('endsWith')).toBe('ends with');
  });

  it('keeps every built-in arity', () => {
    expect(operatorArity('isEmpty')).toBe(0);
    expect(operatorArity('isNotEmpty')).toBe(0);
    expect(operatorArity('between')).toBe(2);
    expect(operatorArity('isAnyOf')).toBe('many');
    expect(operatorArity('in')).toBe('many');
    expect(operatorArity('contains')).toBe(1);
    expect(operatorArity('nobody-declared-this')).toBe(1);
  });
});

describe('registerDataTableFilterType', () => {
  it('registers a type, offers its operators and reports its arity', () => {
    register(tagsType());
    const column: DataTableColumn<Row> = { id: 'tags', label: 'Tags', priority: 'secondary', filter: { type: 'tags' } };
    expect(isFilterableColumn(column)).toBe(true);
    expect(operatorsForColumn(column)).toEqual(['hasAny', 'hasAll']);
    expect(operatorArity('hasAll')).toBe('many');
    expect(operatorLabel('hasAll', 'tags')).toBe('has all of');
    expect(draftFilterFor(column)).toEqual({ columnId: 'tags', operator: 'hasAny', value: [] });
    expect(isFilterComplete({ columnId: 'tags', operator: 'hasAny', value: [] })).toBe(false);
    expect(isFilterComplete({ columnId: 'tags', operator: 'hasAny', value: ['a'] })).toBe(true);
  });

  it('unregisters, leaving the built-ins', () => {
    const off = registerDataTableFilterType(tagsType({ type: 'colors' }));
    expect(getDataTableFilterType('colors')).toBeDefined();
    off();
    expect(getDataTableFilterType('colors')).toBeUndefined();
    expect(getDataTableFilterType('text')).toBeDefined();
  });

  it('refuses a malformed id, a taken id, no operators, no matcher and a contradicting arity', () => {
    expect(() => registerDataTableFilterType(tagsType({ type: 'Bad Id' }))).toThrow(/must match/);
    expect(() => registerDataTableFilterType(tagsType({ type: 'text' }))).toThrow(/already registered/);
    expect(() => registerDataTableFilterType(tagsType({ type: 'empty', operators: [] }))).toThrow(/at least one operator/);
    expect(() => registerDataTableFilterType(tagsType({ type: 'nomatch', matches: undefined as never }))).toThrow(/matches function/);
    expect(() => registerDataTableFilterType(tagsType({ type: 'clash', operators: [{ id: 'contains', label: 'has', arity: 'many' }] }))).toThrow(
      /one operator id has one arity/,
    );
    expect(() => registerDataTableFilterType(tagsType({ type: 'twice', operators: [{ id: 'tw', label: 'a', arity: 1 }, { id: 'tw', label: 'b', arity: 1 }] }))).toThrow(
      /twice/,
    );
    expect(() => registerDataTableFilterType(tagsType({ type: 'nolabel', operators: [{ id: 'nl', label: ' ', arity: 1 }] }))).toThrow(/needs a label/);
    // a type may reuse a built-in operator id when the arity agrees
    register(tagsType({ type: 'reuse', operators: [{ id: 'contains', label: 'includes', arity: 1 }] }));
    expect(operatorLabel('contains', 'reuse')).toBe('includes');
    expect(operatorLabel('contains', 'text')).toBe('contains');
  });

  it('a column naming an unregistered type is not filterable, and says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const column: DataTableColumn<Row> = { id: 'x', label: 'X', priority: 'secondary', filterable: true, filterType: 'ghost' };
    expect(isFilterableColumn(column)).toBe(false);
    expect(isFilterableColumn(column)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/"ghost".*registerDataTableFilterType/);
  });
});

describe('a column filter declaration', () => {
  it('makes a column filterable unless filterable is false, and wins over filterType', () => {
    const base = { id: 'c', label: 'C', priority: 'secondary' as const };
    expect(isFilterableColumn({ ...base, filter: { type: 'number' } })).toBe(true);
    expect(isFilterableColumn({ ...base, filter: { type: 'number' }, filterable: false })).toBe(false);
    expect(operatorsForColumn({ ...base, filter: { type: 'number' }, filterType: 'text' })).toEqual(['equals', 'gt', 'lt', 'between']);
    expect(isFilterableColumn({ ...base, filter: { type: 'enum' } })).toBe(false); // no enumValues
    expect(isFilterableColumn({ ...base })).toBe(false);
  });

  it('takes its own operators with their words and arities, learnt for the column-free helpers', () => {
    const column: DataTableColumn<Row> = {
      id: 'name',
      label: 'Name',
      priority: 'primary',
      filter: {
        type: 'text',
        operators: [
          { id: 'matchesRegex', label: 'matches the pattern', arity: 1 },
          { id: 'inRange', label: 'is within', arity: 2 },
        ],
      },
    };
    expect(isFilterableColumn(column)).toBe(true);
    expect(operatorsForColumn(column)).toEqual(['matchesRegex', 'inRange']);
    expect(columnOperatorLabel(column, 'inRange')).toBe('is within');
    expect(operatorArity('inRange')).toBe(2);
    expect(isFilterComplete({ columnId: 'name', operator: 'inRange', value: ['a', ''] })).toBe(false);
    expect(isFilterComplete({ columnId: 'name', operator: 'inRange', value: ['a', 'b'] })).toBe(true);
    expect(filterChipLabel({ columnId: 'name', operator: 'inRange', value: ['a', 'b'] }, [column])).toBe('Name is within a and b');
  });

  it('keeps an explicit operator array as the pin', () => {
    register(tagsType({ type: 'tagz' }));
    const column: DataTableColumn<Row> = { id: 'tags', label: 'Tags', priority: 'secondary', filterable: ['hasAll'], filter: { type: 'tagz' } };
    expect(operatorsForColumn(column)).toEqual(['hasAll']);
  });
});

describe('chips and URLs for a custom type', () => {
  const column: DataTableColumn<Row> = { id: 'tags', label: 'Tags', priority: 'secondary', filter: { type: 'tags' } };

  it('uses the type format for the operand words', () => {
    register(tagsType({ format: (operand) => `#${String(operand)}` }));
    expect(filterChipLabel({ columnId: 'tags', operator: 'hasAll', value: ['a', 'b'] }, [column])).toBe('Tags has all of #a, #b');
  });

  it('round-trips through the URL, coercing operands with the type', () => {
    register(tagsType({ coerce: (raw) => raw.toUpperCase() }));
    const params = writeDataTableUrlState(new URLSearchParams(), { filters: [{ columnId: 'tags', operator: 'hasAny', value: ['a', 'b'] }], search: '' });
    const read = readDataTableUrlState(params, { columns: [column] });
    expect(read.filters).toEqual([{ columnId: 'tags', operator: 'hasAny', value: ['A', 'B'] }]);
    // without columns every scalar stays a string
    expect(readDataTableUrlState(params).filters[0]!.value).toEqual(['a', 'b']);
  });
});

describe('client-side matching helpers', () => {
  const columns: DataTableColumn<Row>[] = [
    { id: 'name', label: 'Name', priority: 'primary', filterable: true },
    { id: 'n', label: 'N', priority: 'secondary', filterable: true, filterType: 'number' },
    { id: 'day', label: 'Day', priority: 'secondary', filterable: true, filterType: 'date' },
    { id: 'state', label: 'State', priority: 'secondary', filterable: true, filterType: 'enum', enumValues: [{ value: 'ok', label: 'OK' }] },
    { id: 'on', label: 'On', priority: 'secondary', filterable: true, filterType: 'boolean', value: (row) => (row.on ? 'true' : 'false') },
  ];
  const row: Row = { id: '1', tags: ['a'], name: 'Alpha Beta', n: 5, day: '2026-03-04T10:00:00Z', state: 'ok', on: true };

  it('implements every built-in operator', () => {
    const m = (type: string, value: unknown, operator: string, operand: never) => matchesFilterValue(type, value, operator, operand);
    expect(m('text', 'Alpha', 'contains', 'LPH' as never)).toBe(true);
    expect(m('text', 'Alpha', 'equals', 'alpha' as never)).toBe(true);
    expect(m('text', 'Alpha', 'startsWith', 'al' as never)).toBe(true);
    expect(m('text', 'Alpha', 'endsWith', 'HA' as never)).toBe(true);
    expect(m('text', '', 'isEmpty', null as never)).toBe(true);
    expect(m('text', 'x', 'isNotEmpty', null as never)).toBe(true);
    expect(m('number', 5, 'gt', 4 as never)).toBe(true);
    expect(m('number', 5, 'gte', 5 as never)).toBe(true);
    expect(m('number', 5, 'lt', 5 as never)).toBe(false);
    expect(m('number', 5, 'lte', 5 as never)).toBe(true);
    expect(m('number', 5, 'between', [1, 5] as never)).toBe(true);
    expect(m('number', null, 'equals', 5 as never)).toBe(false);
    expect(m('date', '2026-03-04T10:00:00Z', 'before', '2026-03-05' as never)).toBe(true);
    expect(m('date', '2026-03-04', 'after', '2026-03-04' as never)).toBe(false);
    expect(m('date', '2026-03-04', 'between', ['2026-03-04', '2026-03-05'] as never)).toBe(true);
    expect(m('enum', 'ok', 'is', 'ok' as never)).toBe(true);
    expect(m('enum', 'ok', 'isNot', 'ok' as never)).toBe(false);
    expect(m('enum', 'ok', 'isAnyOf', ['x', 'ok'] as never)).toBe(true);
    expect(m('enum', 'ok', 'in', ['x'] as never)).toBe(false);
    expect(m('boolean', 'true', 'is', true as never)).toBe(true);
    expect(m('boolean', 'false', 'is', true as never)).toBe(false);
    expect(m('ghost', 'x', 'is', 'x' as never)).toBe(false);
  });

  it('AND-s a model over a row and ignores a filter on a removed column', () => {
    expect(matchesFilters(row, columns, [{ columnId: 'name', operator: 'contains', value: 'beta' }, { columnId: 'n', operator: 'between', value: [1, 9] }])).toBe(true);
    expect(matchesFilters(row, columns, [{ columnId: 'name', operator: 'contains', value: 'zeta' }])).toBe(false);
    expect(matchesFilters(row, columns, [{ columnId: 'removed', operator: 'equals', value: 'x' }])).toBe(true);
    expect(matchesFilters(row, columns, [{ columnId: 'on', operator: 'is', value: true }])).toBe(true);
  });
});
