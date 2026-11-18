import { metricGroupPresentationSchema } from '@marinoscar/platform-contract/telemetry';
import type { MetricGroupPresentation, MetricUnitDescriptor } from '@marinoscar/platform-contract/telemetry';

import type { MetricFamily, MetricRatio, MetricTableSpec } from './metric-catalog';
import { BUILTIN_UNIT_ID_SET, isMetricUnit, metricUnitRegistry } from './metric-unit.registry';

// =============================================================================
// A metric group's presentation: validation, and the units it needs (PP-14.18)
// =============================================================================
//
// `MetricGroupDef.presentation` is DATA the web renders (tiles, charts, tables,
// computed columns). The schema (`metricGroupPresentationSchema`, the contract)
// bounds its size and shape; the checks below tie it to the group that carries
// it, at REGISTRATION, so a typo fails boot with the entry named instead of
// rendering an empty section:
//
//   - a tile names a tile the group emits (a family or ratio key, or
//     `<family>.<value>` for a family with `tileGroups`);
//   - a chart names families or ratios of the group, all in one unit, and its
//     title is unique (the title is the chart's accessible name and its key);
//   - a table names a table of the group, once; a table's columns are unique;
//   - a virtual column names a table of the group, and an id of its own;
//   - every `unit` is a registered unit.
//
// Nothing here is ever evaluated as code: a presentation holds no function, and
// the web resolves every word of it against its own renderers.
//
// ⚠ FRAMEWORK-FREE, like the registry that calls it.
// =============================================================================

/** The slice of a group definition the checks read. */
export interface PresentationOwner {
  id: string;
  families: readonly MetricFamily[];
  ratios?: readonly MetricRatio[];
  tables?: readonly MetricTableSpec[];
  presentation?: MetricGroupPresentation;
}

/** The tile keys a group emits: a family key, `<family>.<value>` per tile group, a ratio key. */
export function groupTileKeys(group: PresentationOwner): Set<string> {
  const keys = new Set<string>();
  for (const family of group.families) {
    if (family.tile === false) continue;
    if (family.tileGroups) for (const value of family.tileGroups) keys.add(`${family.key}.${value}`);
    else keys.add(family.key);
  }
  for (const ratio of group.ratios ?? []) keys.add(ratio.key);
  return keys;
}

function unitOf(group: PresentationOwner, key: string): string | undefined {
  return group.families.find((family) => family.key === key)?.unit ?? group.ratios?.find((ratio) => ratio.key === key)?.unit;
}

/**
 * Checks `group.presentation` against the schema and the group. Throws a plain
 * `Error` naming the offending entry; does nothing for a group without one.
 *
 * @param group - the group definition.
 */
export function assertPresentation(group: PresentationOwner): void {
  if (group.presentation === undefined) return;
  const where = `Metric group "${group.id}" presentation`;

  const parsed = metricGroupPresentationSchema.safeParse(group.presentation);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
    throw new Error(`${where} is invalid (${problems}).`);
  }
  const presentation = parsed.data;

  const unit = (id: string | undefined, what: string): void => {
    if (id !== undefined && !isMetricUnit(id)) {
      throw new Error(`${where} ${what} has unit ${JSON.stringify(id)}, which is not registered (registerMetricUnit).`);
    }
  };
  const unique = (values: readonly string[], what: string): void => {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) throw new Error(`${where} names ${what} "${value}" twice.`);
      seen.add(value);
    }
  };

  const tileKeys = groupTileKeys(group);
  unique(
    (presentation.tiles ?? []).map((tile) => tile.metric),
    'tile',
  );
  for (const tile of presentation.tiles ?? []) {
    if (!tileKeys.has(tile.metric)) {
      throw new Error(
        `${where} has a tile for "${tile.metric}", which the group does not emit ` +
          `(expected one of ${[...tileKeys].join(', ') || '(none)'}).`,
      );
    }
    unit(tile.unit, `tile "${tile.metric}"`);
  }

  unique(
    (presentation.series ?? []).map((chart) => chart.title),
    'chart',
  );
  for (const chart of presentation.series ?? []) {
    unique(chart.metrics, `metric of chart "${chart.title}"`);
    const units = new Set<string>();
    for (const metric of chart.metrics) {
      const metricUnit = unitOf(group, metric);
      if (metricUnit === undefined) {
        throw new Error(`${where} chart "${chart.title}" draws "${metric}", which is not a family or ratio of the group.`);
      }
      units.add(metricUnit);
    }
    if (units.size > 1) {
      throw new Error(
        `${where} chart "${chart.title}" mixes units (${[...units].join(', ')}); a chart has one y axis, so its metrics share a unit.`,
      );
    }
  }

  const tableKeys = new Set((group.tables ?? []).map((table) => table.key));
  unique(
    (presentation.tables ?? []).map((table) => table.metric),
    'table',
  );
  for (const table of presentation.tables ?? []) {
    if (!tableKeys.has(table.metric)) {
      throw new Error(
        `${where} has a table "${table.metric}", which the group does not declare ` +
          `(expected one of ${[...tableKeys].join(', ') || '(none)'}).`,
      );
    }
    unique(
      (table.columns ?? []).map((column) => column.key),
      `column of table "${table.metric}"`,
    );
  }

  unique(
    (presentation.virtualColumns ?? []).map((column) => column.id),
    'virtual column',
  );
  for (const column of presentation.virtualColumns ?? []) {
    if (column.table !== undefined && !tableKeys.has(column.table)) {
      throw new Error(`${where} virtual column "${column.id}" is for table "${column.table}", which the group does not declare.`);
    }
    unit(column.unit, `virtual column "${column.id}"`);
  }
}

/**
 * The descriptors of the units a group uses that the platform does not define:
 * the ones `/metric-groups` serves so the web can format them. Platform groups
 * use none.
 *
 * @param group - the group definition.
 * @returns the descriptors, in registration order.
 */
export function customUnitsOf(group: PresentationOwner): MetricUnitDescriptor[] {
  const used = new Set<string>();
  const add = (id: string | undefined): void => {
    if (id !== undefined && !BUILTIN_UNIT_ID_SET.has(id)) used.add(id);
  };
  for (const family of group.families) add(family.unit);
  for (const ratio of group.ratios ?? []) add(ratio.unit);
  for (const table of group.tables ?? []) {
    for (const part of table.parts) add(part.unit);
    for (const derived of table.derived ?? []) add(derived.unit);
  }
  for (const tile of group.presentation?.tiles ?? []) add(tile.unit);
  for (const column of group.presentation?.virtualColumns ?? []) add(column.unit);
  return metricUnitRegistry.list().filter((unit) => used.has(unit.id));
}
