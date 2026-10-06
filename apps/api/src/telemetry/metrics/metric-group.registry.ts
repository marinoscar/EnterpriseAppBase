import { defineRegistry, RegistryError, type Registry } from '../../common/registry';
import type { MetricFamily, MetricFilterKey, MetricRatio, MetricTableSpec } from './metric-catalog';
import { METRIC_FILTER_COLUMNS, METRIC_UNITS } from './metric-catalog.helpers';

// =============================================================================
// The metric-group registry (issue #680, epic #660)
// =============================================================================
//
// The Telemetry Dashboard's `/metrics` route, its sections and the assistant's
// `metrics_overview` tool serve whatever groups are registered here. A group
// is the unit an app adds (docs/specs/platform-packages.md, "Worked example: a
// new metric group"): it carries its own families, ratios and tables, so the
// rule "a family belongs to the group that declares it" is structural.
//
// The six platform groups are declared in `groups/*.metric-group.ts` and
// registered, in their historic order, by `metric-group.manifest.ts`, which
// then registers the app's `APP_METRIC_GROUPS`
// (`app-registrations/telemetry.ts`). Consumers import from
// `metric-catalog.ts`, which imports the manifest, never from this file: a
// read through this file alone may see an empty registry.
//
// ⚠ FRAMEWORK-FREE. A static registry (common/registry/README.md): the DTOs
// build their `group` enum from it while their module is evaluated, and
// `npm run openapi:dump` reads them in preview mode. Its only runtime imports
// are the registry primitive and the catalog's leaf helpers.
//
// Every rule below runs at REGISTRATION, so a malformed group fails at import
// time (the app does not start) instead of at the first dashboard read.
// =============================================================================

/** One dashboard metric group: what `/metrics?group=<id>` serves and the dashboard renders as a section. */
export interface MetricGroupDef {
  /** `host`. Lower snake_case: `/^[a-z][a-z0-9_]*$/`. Permanent: it is a query value and a URL anchor. */
  id: string;
  /** The API's label, e.g. `Host` (`METRIC_GROUP_LABELS`). */
  label: string;
  /** The dashboard section title, e.g. `Infrastructure`. */
  title: string;
  /** Dashboard order, ascending; ties sort by id. The platform uses 10, 20, … 60. */
  order: number;
  /** One line naming what the group covers; the assistant tool describes the group with it. */
  description: string;
  /** The group's families. Each `family.group` equals `id`. */
  families: readonly MetricFamily[];
  /** Families derived from others. Each `ratio.group` equals `id`. */
  ratios?: readonly MetricRatio[];
  /** Per-key tables. Each `table.group` equals `id`. */
  tables?: readonly MetricTableSpec[];
}

/**
 * The augmentable set of group ids: the platform's six here; an app adds its
 * own by module augmentation in `app-registrations/telemetry.ts`:
 *
 * ```ts
 * declare module '../telemetry/metrics/metric-group.registry' {
 *   interface MetricGroupIds { coach: true }
 * }
 * ```
 */
export interface MetricGroupIds {
  host: true;
  database: true;
  queue: true;
  nodes: true;
  uptime: true;
  pipeline: true;
}

/** A registered metric group id. */
export type MetricGroup = keyof MetricGroupIds & string;

/** The pattern every group id matches. */
export const METRIC_GROUP_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

const UNITS = new Set<string>(METRIC_UNITS);
const FILTER_KEYS = new Set<string>(Object.keys(METRIC_FILTER_COLUMNS));

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertUnit(unit: unknown, where: string): void {
  if (typeof unit !== 'string' || !UNITS.has(unit)) {
    throw new Error(`${where} has unit ${JSON.stringify(unit)}; expected one of ${METRIC_UNITS.join(', ')}.`);
  }
}

function assertFilters(filters: unknown, where: string): void {
  if (!Array.isArray(filters)) throw new Error(`${where} must declare its filters (an array).`);
  for (const filter of filters) {
    if (!FILTER_KEYS.has(filter)) {
      throw new Error(`${where} has filter ${JSON.stringify(filter)}; expected one of ${[...FILTER_KEYS].join(', ')}.`);
    }
  }
}

function assertText(value: unknown, where: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${where} must be a non-empty string.`);
}

/**
 * Every rule a group must satisfy, against the groups already known
 * (`known`: registered ones, plus earlier groups of the same batch). Throws a
 * plain `Error` naming the offending entry.
 *
 * A known group with the SAME id is ignored, so re-registering an id reports
 * the registry's `DUPLICATE_ID` rather than a key clash with itself.
 */
export function assertMetricGroup(group: MetricGroupDef, known: readonly MetricGroupDef[]): void {
  const others = known.filter((g) => g.id !== group.id);
  const families = group.families;
  const ratios = group.ratios ?? [];
  const tables = group.tables ?? [];

  assertText(group.label, `Metric group "${group.id}" label`);
  assertText(group.title, `Metric group "${group.id}" title`);
  assertText(group.description, `Metric group "${group.id}" description`);
  if (typeof group.order !== 'number' || !Number.isFinite(group.order)) {
    throw new Error(`Metric group "${group.id}" order must be a finite number.`);
  }
  if (!Array.isArray(families)) throw new Error(`Metric group "${group.id}" must declare its families (an array).`);
  if (families.length === 0 && tables.length === 0) {
    throw new Error(`Metric group "${group.id}" declares no family and no table: it would render nothing.`);
  }

  // One key namespace across families, ratios and tables of EVERY group: a key
  // names a tile, a series, a `skipped` entry and a ratio reference.
  const taken = new Map<string, string>();
  for (const other of others) {
    for (const entry of [...other.families, ...(other.ratios ?? []), ...(other.tables ?? [])]) {
      taken.set(entry.key, other.id);
    }
  }
  const claim = (key: unknown, what: string): void => {
    assertText(key, `A ${what} of metric group "${group.id}" key`);
    const owner = taken.get(key as string);
    if (owner !== undefined) {
      throw new Error(
        `Metric group "${group.id}" ${what} key "${String(key)}" is already used by group "${owner}"; ` +
          'family, ratio and table keys are unique across every group.',
      );
    }
    taken.set(key as string, group.id);
  };
  const belongs = (entryGroup: unknown, key: string, what: string): void => {
    if (entryGroup !== group.id) {
      throw new Error(
        `Metric group "${group.id}" declares ${what} "${key}" with group ${JSON.stringify(entryGroup)}; ` +
          `it must be "${group.id}".`,
      );
    }
  };

  const familyKinds = new Map<string, MetricFamily['kind']>();
  for (const other of others) for (const f of other.families) familyKinds.set(f.key, f.kind);

  for (const family of families) {
    claim(family.key, 'family');
    belongs(family.group, family.key, 'family');
    assertUnit(family.unit, `Family "${family.key}"`);
    assertFilters(family.filters, `Family "${family.key}"`);
    assertText(family.table, `Family "${family.key}" table`);
    familyKinds.set(family.key, family.kind);
  }

  for (const ratio of ratios) {
    claim(ratio.key, 'ratio');
    belongs(ratio.group, ratio.key, 'ratio');
    assertUnit(ratio.unit, `Ratio "${ratio.key}"`);
    for (const ref of [...ratio.numerator, ...ratio.denominator]) {
      if (!familyKinds.has(ref.family)) {
        throw new Error(
          `Ratio "${ratio.key}" references family "${ref.family}", which is not registered ` +
            `(in group "${group.id}" or an earlier one).`,
        );
      }
    }
  }

  for (const table of tables) {
    claim(table.key, 'table');
    belongs(table.group, table.key, 'table');
    assertFilters(table.filters, `Table "${table.key}"`);
    for (const part of table.parts) assertUnit(part.unit, `Table "${table.key}" column "${part.column}"`);
    for (const derived of table.derived ?? []) {
      assertUnit(derived.unit, `Table "${table.key}" column "${derived.column}"`);
    }
    if (table.histogram && familyKinds.get(table.histogram.family) !== 'histogram') {
      throw new Error(
        `Table "${table.key}" reads histogram family "${table.histogram.family}", which is not a registered ` +
          `histogram family (in group "${group.id}" or an earlier one).`,
      );
    }
  }
}

/**
 * Every registered metric group, in dashboard order (`order`, then id).
 *
 * Read it through `metric-catalog.ts`, which imports the manifest that fills
 * it. Frozen once the Nest application has bootstrapped.
 */
export const metricGroupRegistry: Registry<MetricGroupDef> = defineRegistry<MetricGroupDef>({
  name: 'telemetry-metric-groups',
  idOf: (group) => group.id,
  idPattern: METRIC_GROUP_ID_PATTERN,
  validate: (group, registry) => assertMetricGroup(group, registry.list()),
  describeDuplicate: (_existing, incoming) =>
    `Duplicate metric group id "${incoming.id}": a group id is registered once (platform groups first, then the app's).`,
  order: (a, b) => a.order - b.order || compareCodeUnits(a.id, b.id),
});

/**
 * Registers `groups`, all or nothing, checking each one against the registered
 * groups AND the earlier groups of the same batch: a ratio or table may
 * reference a family of an earlier group, and keys stay unique across the
 * batch. (`registry.registerAll` alone cannot do that: its `validate` hook does
 * not see the batch's earlier entries. A temporary batch in a test whose groups
 * reference each other therefore uses nested `withTemporaryEntries` calls.)
 *
 * The whole batch is checked first; only then is each group registered, so a
 * refused batch leaves the registry unchanged.
 *
 * @throws RegistryError `INVALID_ENTRY`, `INVALID_ID`, `DUPLICATE_ID` or `FROZEN`.
 */
export function registerMetricGroups(groups: readonly MetricGroupDef[]): void {
  const known = metricGroupRegistry.list();
  const ids = new Set(metricGroupRegistry.ids());

  for (const [index, group] of groups.entries()) {
    const id: unknown = group?.id;
    const canonical =
      metricGroupRegistry.frozen ||
      typeof id !== 'string' ||
      id.length > 128 ||
      !METRIC_GROUP_ID_PATTERN.test(id) ||
      ids.has(id);
    if (canonical) {
      // FROZEN, INVALID_ID or DUPLICATE_ID: let the primitive raise its own
      // error (it refuses the whole batch and changes nothing).
      metricGroupRegistry.registerAll(groups);
      return;
    }
    try {
      assertMetricGroup(group, [...known, ...groups.slice(0, index)]);
    } catch (err) {
      throw new RegistryError(
        'INVALID_ENTRY',
        metricGroupRegistry.name,
        `Invalid entry "${group.id}" in registry "${metricGroupRegistry.name}": ${err instanceof Error ? err.message : String(err)}`,
        { id: group.id, cause: err },
      );
    }
    ids.add(group.id);
  }

  // Every group passed against everything before it, so these cannot fail.
  for (const group of groups) metricGroupRegistry.register(group);
}
