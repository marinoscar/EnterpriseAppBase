/**
 * The formats of the units an app registered, for the dashboard's components
 * (PP-14.18). `GET …/metric-groups` serves the descriptor of every non-built-in
 * unit a group uses; the page folds them into one map and provides it here, so a
 * tile, a table cell and a chart axis format `usd` or `nudges` without each
 * being handed the map.
 */
import { createContext, useContext } from 'react';

import type { MetricUnitFormats } from '../lib/format.js';
import type { DashboardMetricGroupMeta } from '../services/telemetryDashboard.js';

/** No app units: every unit formats as a built-in (or is shown as given). */
const NO_UNIT_FORMATS: MetricUnitFormats = new Map();

/**
 * The unit formats in effect; empty outside a provider.
 *
 * @stability experimental
 */
export const MetricUnitFormatsContext = createContext<MetricUnitFormats>(NO_UNIT_FORMATS);

/**
 * The app unit formats in effect for the dashboard's components.
 *
 * @returns the map of unit id to descriptor (empty when the page serves none).
 *
 * @stability experimental
 */
export function useMetricUnitFormats(): MetricUnitFormats {
  return useContext(MetricUnitFormatsContext);
}

/**
 * Folds the `units` of every group entry into one map. A unit two groups both
 * list is the same unit (the API registers an id once).
 *
 * @param groups - the `/metric-groups` entries.
 * @returns the map; empty when no group uses an app unit.
 *
 * @stability experimental
 */
export function metricUnitFormatsOf(groups: readonly Pick<DashboardMetricGroupMeta, 'units'>[] | null | undefined): MetricUnitFormats {
  const formats = new Map<string, NonNullable<DashboardMetricGroupMeta['units']>[number]>();
  for (const group of groups ?? []) for (const unit of group.units ?? []) formats.set(unit.id, unit);
  return formats.size === 0 ? NO_UNIT_FORMATS : formats;
}
