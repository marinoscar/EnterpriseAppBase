/**
 * DataTable — the filter-type registry (PP-14.20).
 *
 * A FILTER TYPE is what a column's `filterType` / `filter.type` names: the
 * operators it offers, how an operand of it is matched against a value, how a
 * URL operand is coerced back, and (optionally) the control that collects the
 * operand. The five built-ins (`text`, `number`, `date`, `enum`, `boolean`) are
 * registered here through {@link registerDataTableFilterType}, the same call
 * an app uses to add its own (`tags`, `user`), so the platform proves its own
 * extension point. Their operand controls live in `/ui`, which resolves them
 * by type when a definition carries no `Editor`.
 *
 * The registry is a module-level map: register at import time (before the
 * first render), exactly like the settings and doctor registries of this
 * package.
 */

import type { ComponentType } from 'react';

import type {
  BuiltinDataTableFilterType,
  BuiltinFilterOperator,
  DataTableColumn,
  DataTableFilterType,
  DataTableFilterValue,
  FilterOperator,
  FilterOperatorDef,
  FilterValueEditorProps,
  OperatorArity,
} from '../types.js';

/**
 * One filter type.
 *
 * @stability experimental
 * @example
 * ```ts
 * registerDataTableFilterType({
 *   type: 'tags',
 *   operators: [
 *     { id: 'hasAny', label: 'has any of', arity: 'many' },
 *     { id: 'hasAll', label: 'has all of', arity: 'many' },
 *   ],
 *   Editor: TagChipsEditor,
 *   matches: (value, operator, operand) => matchesTags(value, operator, operand),
 * });
 * ```
 */
export interface DataTableFilterTypeDef {
  /** The type id (`tags`); matches {@link FILTER_TYPE_ID_PATTERN}. */
  type: string;
  /** The operators the type offers, in picker order; the first is the default for a fresh filter. */
  operators: readonly FilterOperatorDef[];
  /**
   * The control that collects the operand. Required for a type an app adds (the
   * built-ins' controls are supplied by `/ui`); a column's own
   * `filter.editor` wins over it.
   */
  Editor?: ComponentType<FilterValueEditorProps<any>>;
  /**
   * Whether a row's scalar satisfies a filter. For pages that filter locally
   * (a mock server, a test); the table itself never filters rows. Receives the
   * column's value, the operator and the operand.
   */
  matches(value: unknown, operator: FilterOperator, operand: DataTableFilterValue): boolean;
  /** Turns one URL operand segment back into a scalar (`readDataTableUrlState`). Default: the string. */
  coerce?(raw: string): string | number | boolean;
  /** The words for one operand in a chip ("Urgent"). Default: the value as text. */
  format?(operand: string | number | boolean, column: DataTableColumn<any> | undefined): string;
}

/**
 * What a filter type id looks like: lower case letters and digits, 2 to 32
 * characters, starting with a letter.
 *
 * @stability experimental
 */
export const FILTER_TYPE_ID_PATTERN = /^[a-z][a-z0-9]{1,31}$/;

/**
 * The operators the platform defines, with the words the picker and the chip
 * use. Not every one is in a type's default set (`endsWith`, `gte`, `lte`,
 * `in` and `isNotEmpty` are not); a column may pin any of them.
 *
 * @stability experimental
 */
export const BUILTIN_OPERATORS: Readonly<Record<BuiltinFilterOperator, FilterOperatorDef>> = Object.freeze({
  equals: { id: 'equals', label: 'equals', arity: 1 },
  contains: { id: 'contains', label: 'contains', arity: 1 },
  startsWith: { id: 'startsWith', label: 'starts with', arity: 1 },
  endsWith: { id: 'endsWith', label: 'ends with', arity: 1 },
  gt: { id: 'gt', label: 'is greater than', arity: 1 },
  gte: { id: 'gte', label: 'is at least', arity: 1 },
  lt: { id: 'lt', label: 'is less than', arity: 1 },
  lte: { id: 'lte', label: 'is at most', arity: 1 },
  between: { id: 'between', label: 'is between', arity: 2 },
  before: { id: 'before', label: 'is before', arity: 1 },
  after: { id: 'after', label: 'is after', arity: 1 },
  is: { id: 'is', label: 'is', arity: 1 },
  isNot: { id: 'isNot', label: 'is not', arity: 1 },
  isAnyOf: { id: 'isAnyOf', label: 'is any of', arity: 'many' },
  in: { id: 'in', label: 'is any of', arity: 'many' },
  isEmpty: { id: 'isEmpty', label: 'is empty', arity: 0 },
  isNotEmpty: { id: 'isNotEmpty', label: 'is not empty', arity: 0 },
});

const TYPES = new Map<string, DataTableFilterTypeDef>();
/** operator id -> arity: the built-ins, then whatever registered types and columns taught. */
const ARITIES = new Map<string, OperatorArity>(Object.values(BUILTIN_OPERATORS).map((def) => [def.id, def.arity]));

function learnOperator(def: FilterOperatorDef, source: string): void {
  if (typeof def.id !== 'string' || def.id === '') throw new Error(`${source}: an operator needs an id`);
  if (typeof def.label !== 'string' || def.label.trim() === '') throw new Error(`${source}: operator "${def.id}" needs a label`);
  if (!(def.arity === 0 || def.arity === 1 || def.arity === 2 || def.arity === 'many')) {
    throw new Error(`${source}: operator "${def.id}" arity must be 0, 1, 2 or 'many'`);
  }
  const known = ARITIES.get(def.id);
  if (known !== undefined && known !== def.arity) {
    throw new Error(
      `${source}: operator "${def.id}" already takes ${String(known)} operand(s) elsewhere; one operator id has one arity (pick another id)`,
    );
  }
}

/** Remembers an operator's arity (after {@link learnOperator} accepted it). */
function remember(def: FilterOperatorDef): void {
  if (!ARITIES.has(def.id)) ARITIES.set(def.id, def.arity);
}

/**
 * Registers a filter type. Returns a function that removes it again (for a
 * test), leaving the operators it taught the catalog in place.
 *
 * @param def - the type.
 * @returns the unregister function.
 * @throws Error when the id is malformed or taken, an operator is invalid or contradicts the arity another type gave the same operator id, or `matches` is missing.
 *
 * @example
 * ```ts
 * registerDataTableFilterType({ type: 'tags', operators: [...], Editor: TagChipsEditor, matches });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerDataTableFilterType(def: DataTableFilterTypeDef): () => void {
  if (typeof def.type !== 'string' || !FILTER_TYPE_ID_PATTERN.test(def.type)) {
    throw new Error(`Filter type id ${JSON.stringify(def.type)} must match ${FILTER_TYPE_ID_PATTERN}`);
  }
  if (TYPES.has(def.type)) throw new Error(`Filter type "${def.type}" is already registered`);
  if (!Array.isArray(def.operators) || def.operators.length === 0) {
    throw new Error(`Filter type "${def.type}" needs at least one operator`);
  }
  if (typeof def.matches !== 'function') throw new Error(`Filter type "${def.type}" needs a matches function`);
  const seen = new Set<string>();
  for (const operator of def.operators) {
    learnOperator(operator, `Filter type "${def.type}"`);
    if (seen.has(operator.id)) throw new Error(`Filter type "${def.type}" lists operator "${operator.id}" twice`);
    seen.add(operator.id);
  }
  for (const operator of def.operators) remember(operator);
  TYPES.set(def.type, def);
  return () => {
    if (TYPES.get(def.type) === def) TYPES.delete(def.type);
  };
}

/**
 * The registered definition of a filter type, or `undefined`.
 *
 * @param type - the type id.
 * @returns the definition.
 *
 * @stability experimental
 */
export function getDataTableFilterType(type: DataTableFilterType): DataTableFilterTypeDef | undefined {
  return TYPES.get(type);
}

/**
 * Every registered filter type, the built-ins first.
 *
 * @returns the definitions.
 *
 * @stability experimental
 */
export function listDataTableFilterTypes(): DataTableFilterTypeDef[] {
  return [...TYPES.values()];
}

/**
 * How many operands a (registered or built-in) operator takes; `1` for an id
 * nobody declared.
 *
 * @param operator - the operator id.
 * @returns the arity.
 *
 * @stability experimental
 */
export function knownOperatorArity(operator: FilterOperator): OperatorArity {
  return ARITIES.get(operator) ?? 1;
}

const learnedColumnOperators = new WeakSet<object>();

/**
 * Teaches the catalog the operators a column declared inline
 * (`filter.operators`), once per declaration. A contradiction with an arity
 * already known is logged and the earlier arity kept (a render must not throw).
 *
 * @param operators - the column's inline operator definitions.
 *
 * @stability experimental
 */
export function learnColumnOperators(operators: readonly FilterOperatorDef[] | undefined): void {
  if (!operators || learnedColumnOperators.has(operators)) return;
  learnedColumnOperators.add(operators);
  for (const operator of operators) {
    try {
      learnOperator(operator, 'A column filter');
      remember(operator);
    } catch (error) {
      console.warn(error instanceof Error ? error.message : String(error));
    }
  }
}

// ---------------------------------------------------------------------------
// The five built-ins, registered through the public function
// ---------------------------------------------------------------------------

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const isEmptyValue = (value: unknown): boolean => value === null || value === undefined || value === '';
const asList = (operand: DataTableFilterValue): Array<string | number> => (Array.isArray(operand) ? operand : operand === null ? [] : [operand as string | number]);

function matchesEmptiness(value: unknown, operator: FilterOperator): boolean | undefined {
  if (operator === 'isEmpty') return isEmptyValue(value);
  if (operator === 'isNotEmpty') return !isEmptyValue(value);
  return undefined;
}

const pick = (...ids: BuiltinFilterOperator[]): FilterOperatorDef[] => ids.map((id) => BUILTIN_OPERATORS[id]);

const BUILTIN_TYPES: ReadonlyArray<DataTableFilterTypeDef & { type: BuiltinDataTableFilterType }> = [
  {
    type: 'text',
    operators: pick('contains', 'equals', 'startsWith', 'isEmpty'),
    matches(value, operator, operand) {
      const empty = matchesEmptiness(value, operator);
      if (empty !== undefined) return empty;
      const left = text(value).toLowerCase();
      const right = text(operand).toLowerCase();
      switch (operator) {
        case 'contains':
          return left.includes(right);
        case 'equals':
          return left === right;
        case 'startsWith':
          return left.startsWith(right);
        case 'endsWith':
          return left.endsWith(right);
        default:
          return false;
      }
    },
  },
  {
    type: 'number',
    operators: [
      // A number picker reads `=`, `>`, `<` rather than words.
      { ...BUILTIN_OPERATORS.equals, label: '=' },
      { ...BUILTIN_OPERATORS.gt, label: '>' },
      { ...BUILTIN_OPERATORS.lt, label: '<' },
      BUILTIN_OPERATORS.between,
    ],
    matches(value, operator, operand) {
      const empty = matchesEmptiness(value, operator);
      if (empty !== undefined) return empty;
      const n = typeof value === 'number' ? value : Number(value);
      if (isEmptyValue(value) || !Number.isFinite(n)) return false;
      if (operator === 'between') {
        const [from, to] = asList(operand).map(Number);
        return from !== undefined && to !== undefined && n >= from && n <= to;
      }
      const m = Number(operand);
      switch (operator) {
        case 'equals':
          return n === m;
        case 'gt':
          return n > m;
        case 'gte':
          return n >= m;
        case 'lt':
          return n < m;
        case 'lte':
          return n <= m;
        default:
          return false;
      }
    },
    coerce: (raw) => {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : raw;
    },
  },
  {
    type: 'date',
    operators: pick('before', 'after', 'between'),
    matches(value, operator, operand) {
      const empty = matchesEmptiness(value, operator);
      if (empty !== undefined) return empty;
      if (isEmptyValue(value)) return false;
      // Dates travel as YYYY-MM-DD; a datetime value compares by its day.
      const day = text(value).slice(0, 10);
      if (operator === 'between') {
        const [from, to] = asList(operand).map(String);
        return from !== undefined && to !== undefined && day >= from && day <= to;
      }
      const other = text(operand).slice(0, 10);
      if (operator === 'before') return day < other;
      if (operator === 'after') return day > other;
      return false;
    },
  },
  {
    type: 'enum',
    operators: pick('is', 'isNot', 'isAnyOf'),
    matches(value, operator, operand) {
      const empty = matchesEmptiness(value, operator);
      if (empty !== undefined) return empty;
      const v = text(value);
      switch (operator) {
        case 'is':
          return v === text(operand);
        case 'isNot':
          return v !== text(operand);
        case 'isAnyOf':
        case 'in':
          return asList(operand).map(String).includes(v);
        default:
          return false;
      }
    },
  },
  {
    type: 'boolean',
    operators: pick('is'),
    matches(value, operator, operand) {
      const empty = matchesEmptiness(value, operator);
      if (empty !== undefined) return empty;
      const truthy = value === true || value === 'true' || value === 1 || value === 'yes';
      return operator === 'is' ? truthy === (operand === true || operand === 'true') : false;
    },
    coerce: (raw) => raw === 'true',
  },
];

for (const def of BUILTIN_TYPES) registerDataTableFilterType(def);
