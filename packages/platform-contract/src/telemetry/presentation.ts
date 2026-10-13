// =============================================================================
// How a metric group looks, and the units its numbers use (PP-14.18)
// =============================================================================
//
// DATA ONLY. A group's `presentation` is a bounded, strict, zod-validated
// document of ids, labels and closed vocabularies (a theme colour TOKEN, a
// column display KIND, a virtual-column EXPRESSION). It holds no function, no
// component, no CSS and no HTML: the web resolves every word against its own
// renderers, so an app (or a dependency of an app) can restyle a section and
// cannot run code in the browser. Every string is length-bounded and every
// array is capped (`METRIC_PRESENTATION_LIMITS`); text is rendered as text.
//
// `GET /api/admin/telemetry/dashboard/metric-groups` serves each group's
// presentation (and the descriptors of the units it uses that the platform does
// not define); the dashboard renders it, falling back to its defaults for a
// section a group leaves out.
// =============================================================================

import { z } from 'zod';

import {
  METRIC_PRESENTATION_LIMITS,
  METRIC_UNIT_FORMATS,
  METRIC_UNIT_ID_PATTERN,
  PLATFORM_METRIC_GROUPS,
  PRESENTATION_COLUMN_DISPLAYS,
  PRESENTATION_COLOR_TOKENS,
  VIRTUAL_COLUMN_EXPRESSIONS,
} from './constants.js';
import { wireEnum } from './enum.js';

const LIMITS = METRIC_PRESENTATION_LIMITS;

const label = z.string().trim().min(1).max(LIMITS.label);
const key = z.string().min(1).max(LIMITS.key).regex(/^[A-Za-z][A-Za-z0-9_.]*$/);

/**
 * A metric unit id: a built-in one or an app's registered one
 * ({@link METRIC_UNIT_ID_PATTERN}).
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const metricUnitIdSchema = z.string().regex(METRIC_UNIT_ID_PATTERN);

/**
 * A theme colour token ({@link PRESENTATION_COLOR_TOKENS}), never a CSS colour.
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const themeColorTokenSchema = wireEnum(PRESENTATION_COLOR_TOKENS);

/**
 * A metric unit: `id`, a human `label`, and how the web formats a value of it
 * (`format`, plus `currency` for `currency`, `decimals` and `suffix` for
 * `number`).
 *
 * @example
 * ```ts
 * { id: 'usd', label: 'US dollars', format: 'currency', currency: 'USD', decimals: 2 }
 * ```
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const metricUnitDescriptorSchema = z
  .object({
    /** The id a family, ratio, table column or presentation names as its `unit`. */
    id: metricUnitIdSchema,
    /** A human name (`US dollars`). */
    label: z.string().trim().min(1).max(LIMITS.unitLabel),
    /** How a value is formatted. */
    format: wireEnum(METRIC_UNIT_FORMATS),
    /** The ISO 4217 code of a `currency` unit (`USD`). Required for `currency`, refused otherwise. */
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    /** Fraction digits to show (0 to 6). Default: the format's own. */
    decimals: z.number().int().min(0).max(LIMITS.unitDecimals).optional(),
    /** Text after a `number` value (`/s`, ` nudges`). */
    suffix: z.string().max(LIMITS.unitSuffix).optional(),
  })
  .strict()
  .superRefine((unit, ctx) => {
    if (unit.format === 'currency' && unit.currency === undefined) {
      ctx.addIssue({ code: 'custom', path: ['currency'], message: 'A currency unit needs its ISO 4217 `currency` code.' });
    }
    if (unit.format !== 'currency' && unit.currency !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['currency'], message: '`currency` applies to the `currency` format only.' });
    }
    if (unit.format !== 'number' && unit.suffix !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['suffix'], message: '`suffix` applies to the `number` format only.' });
    }
  });

/**
 * A metric unit.
 *
 * @stability experimental
 */
export type MetricUnitDescriptor = z.infer<typeof metricUnitDescriptorSchema>;

/**
 * One headline tile: the metric (a family or ratio key, with the
 * `.<tileGroup>` suffix of a family that emits one tile per group value), and
 * optionally its label, unit and colour.
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const presentationTileSchema = z
  .object({
    /** The family or ratio key (or `<family>.<value>` of a family with `tileGroups`). */
    metric: key,
    /** Replaces the tile's label. */
    label: label.optional(),
    /** Replaces the tile's unit (a registered unit id). */
    unit: metricUnitIdSchema.optional(),
    /** Draws the value in this theme colour. */
    color: themeColorTokenSchema.optional(),
  })
  .strict();

/**
 * One headline tile of a presentation.
 *
 * @stability experimental
 */
export type PresentationTile = z.infer<typeof presentationTileSchema>;

/**
 * One line chart: the metrics (family or ratio keys) drawn together, and a
 * colour per `groupBy` value (a status colour for an outcome, say).
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const presentationSeriesSchema = z
  .object({
    /** The chart's title: its accessible name. */
    title: label,
    /** The family or ratio keys drawn, in legend order. They share one unit. */
    metrics: z.array(key).min(1).max(LIMITS.chartMetrics),
    /** Theme colours by `groupBy` value (`succeeded: 'ok'`); other lines take the series palette. */
    colors: z
      .record(z.string().min(1).max(LIMITS.key), themeColorTokenSchema)
      .refine((colors) => Object.keys(colors).length <= LIMITS.chartColors, {
        message: `At most ${LIMITS.chartColors} colour overrides.`,
      })
      .optional(),
  })
  .strict();

/**
 * One line chart of a presentation.
 *
 * @stability experimental
 */
export type PresentationSeries = z.infer<typeof presentationSeriesSchema>;

const topNOption = z.union([z.number().int().min(1).max(LIMITS.topNMax), z.literal('all')]);

/**
 * A table's "Top N" row limit: a number N (offers `Top N` and `All`, starting at
 * N), or `{ options, default }` for a select with several counts.
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const presentationTopNSchema = z.union([
  z.number().int().min(1).max(LIMITS.topNMax),
  z
    .object({
      /** The counts offered, ascending, optionally ending in `'all'`. */
      options: z.array(topNOption).min(1).max(LIMITS.topNOptions),
      /** The count shown until the viewer chooses (one of `options`). */
      default: topNOption,
    })
    .strict()
    .refine((topN) => topN.options.includes(topN.default), { message: '`default` must be one of `options`.' }),
]);

/**
 * A table's "Top N" row limit.
 *
 * @stability experimental
 */
export type PresentationTopN = z.infer<typeof presentationTopNSchema>;

/**
 * How one table cell is drawn instead of by its unit: `utilization-bar` (a
 * percentage as a bar, warning from `warnAt`, critical from `criticalAt`),
 * `status` (a boolean as an icon AND a word; `invert` reads `false` as good)
 * or `fraction` (`used / total` of two columns).
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const presentationColumnDisplaySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('utilization-bar'),
      warnAt: z.number().min(0).max(100).optional(),
      criticalAt: z.number().min(0).max(100).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('status'),
      /** The word for a good value (`Up`). */
      okText: z.string().trim().min(1).max(24),
      /** The word for a bad value (`Down`). */
      badText: z.string().trim().min(1).max(24),
      /** Read `false` as good (a "none eligible" flag). */
      invert: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('fraction'),
      /** The two columns shown as `first / second`. */
      of: z.tuple([key, key]),
    })
    .strict(),
]);

/**
 * How one table cell is drawn.
 *
 * @stability experimental
 */
export type PresentationColumnDisplayDef = z.infer<typeof presentationColumnDisplaySchema>;

/**
 * One column of a table: a response column key (or a virtual column id, or a
 * `fraction` column's own key), its header and how it is drawn. A column the
 * response lacks is skipped, never drawn empty.
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const presentationColumnSchema = z
  .object({
    /** A response column key, a virtual column id, or a free key for a `fraction` column. */
    key,
    /** Replaces the column's header. */
    label: label.optional(),
    /** Draws the cell as a bar, a status or a fraction instead of by its unit. */
    display: presentationColumnDisplaySchema.optional(),
  })
  .strict();

/**
 * One column of a presentation's table.
 *
 * @stability experimental
 */
export type PresentationColumn = z.infer<typeof presentationColumnSchema>;

/**
 * One per-key table of a group: the table key, its row limit, its row order
 * (`problems-first` puts failing rows, `up === false` or a flag, first) and
 * its columns (default: every column of the response).
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const presentationTableSchema = z
  .object({
    /** The group's table key. */
    metric: key,
    /** Replaces the table's title. */
    label: label.optional(),
    /** A "Top N" row limit. Absent: every row is drawn. */
    topN: presentationTopNSchema.optional(),
    /** `problems-first`: failing rows before healthy ones; stable otherwise. Absent: the API's order. */
    sort: wireEnum(['problems-first'] as const).optional(),
    /** The columns, in order. Absent: every column of the response. */
    columns: z.array(presentationColumnSchema).min(1).max(LIMITS.columns).optional(),
  })
  .strict();

/**
 * One per-key table of a presentation.
 *
 * @stability experimental
 */
export type PresentationTable = z.infer<typeof presentationTableSchema>;

/**
 * A column computed in the browser from other columns of a table's rows:
 * `ratio` (`a / b` as a percentage), `delta` (`a - b`), `rate` (`a` per second
 * over the window). A row where an input is missing, or a ratio's divisor is
 * zero, reads "—".
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const presentationVirtualColumnSchema = z
  .object({
    /** The column id: a key for `columns`. */
    id: key,
    /** The header. */
    label,
    /** What it computes. */
    expression: wireEnum(VIRTUAL_COLUMN_EXPRESSIONS),
    /** The input columns: two for `ratio` and `delta`, one for `rate`. */
    of: z.array(key).min(1).max(2),
    /** Only this table (default: every table that has every input column). */
    table: key.optional(),
    /** The result's unit (default: `%` for a ratio, `per_s` for a rate, the first input's for a delta). */
    unit: metricUnitIdSchema.optional(),
  })
  .strict()
  .superRefine((column, ctx) => {
    const wanted = column.expression === 'rate' ? 1 : 2;
    if (column.of.length !== wanted) {
      ctx.addIssue({
        code: 'custom',
        path: ['of'],
        message: `A ${column.expression} column takes ${wanted} input column${wanted === 1 ? '' : 's'}.`,
      });
    }
  });

/**
 * A computed column of a presentation.
 *
 * @stability experimental
 */
export type PresentationVirtualColumn = z.infer<typeof presentationVirtualColumnSchema>;

/**
 * How a metric group's dashboard section looks. Every part is optional: an
 * omitted part gets the default (every tile, one chart per series key, every
 * table); a present part, even an empty array, is exactly what is drawn.
 *
 * @example
 * ```ts
 * const presentation: MetricGroupPresentation = {
 *   tiles: [{ metric: 'aiSpend', label: 'AI spend', unit: 'usd', color: 'warn' }],
 *   tables: [{ metric: 'features', topN: 5 }],
 * };
 * ```
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const metricGroupPresentationSchema = z
  .object({
    /** The headline tiles, in order. */
    tiles: z.array(presentationTileSchema).max(LIMITS.tiles).optional(),
    /** The line charts, in order. */
    series: z.array(presentationSeriesSchema).max(LIMITS.charts).optional(),
    /** The tables, in order. */
    tables: z.array(presentationTableSchema).max(LIMITS.tables).optional(),
    /** Columns computed in the browser. */
    virtualColumns: z.array(presentationVirtualColumnSchema).max(LIMITS.virtualColumns).optional(),
  })
  .strict();

/**
 * How a metric group's dashboard section looks.
 *
 * @stability experimental
 */
export type MetricGroupPresentation = z.infer<typeof metricGroupPresentationSchema>;

/**
 * The presentation of the six platform groups, keyed by group id. The
 * platform's metric-group declarations take theirs from here, and the web falls
 * back to these when an API does not serve a presentation, so a section looks
 * the same against any API version.
 *
 * @stability experimental
 */
export const PLATFORM_METRIC_PRESENTATIONS: Readonly<
  Record<(typeof PLATFORM_METRIC_GROUPS)[number], MetricGroupPresentation>
> = Object.freeze({
  host: {
    tiles: [
      { metric: 'cpuUtilization' },
      { metric: 'memoryUtilization' },
      { metric: 'load1m' },
      { metric: 'filesystemUtilization' },
    ],
    series: [{ title: 'CPU and memory utilization', metrics: ['cpuUtilization', 'memoryUtilization'] }],
    tables: [
      {
        metric: 'filesystems',
        columns: [
          { key: 'key' },
          { key: 'utilizationPct', display: { kind: 'utilization-bar' } },
          { key: 'usedBytes' },
          { key: 'freeBytes' },
          { key: 'lastSeenAt' },
        ],
      },
    ],
  },
  database: {
    tiles: [{ metric: 'dbConnectionUtilization' }, { metric: 'dbSize' }, { metric: 'dbCommits' }, { metric: 'dbCacheHitRatio' }],
    series: [{ title: 'Connections and the connection limit', metrics: ['dbConnections', 'dbConnectionMax'] }],
    tables: [{ metric: 'largestTables', topN: { options: [10, 20, 50, 'all'], default: 10 } }],
  },
  queue: {
    tiles: [
      { metric: 'queueDepth.pending' },
      { metric: 'oldestPendingAge' },
      { metric: 'jobFailureRatio' },
      { metric: 'jobDurationP95' },
      { metric: 'backupAge' },
    ],
    series: [
      {
        title: 'Jobs settled per minute by outcome',
        metrics: ['jobsSettled'],
        colors: { succeeded: 'ok', failed: 'crit' },
      },
    ],
    tables: [{ metric: 'jobTypes' }],
  },
  nodes: {
    tiles: [
      { metric: 'nodesByHealth.healthy' },
      { metric: 'nodesByHealth.stale' },
      { metric: 'nodesByHealth.offline' },
      { metric: 'noEligibleNode' },
    ],
    series: [],
    tables: [
      {
        metric: 'nodes',
        columns: [
          { key: 'key' },
          { key: 'cpuCores' },
          { key: 'rssBytes' },
          { key: 'heapPct', display: { kind: 'utilization-bar' } },
          { key: 'stateDirFreePct' },
          { key: 'slots', label: 'Slots used', display: { kind: 'fraction', of: ['slotsUsed', 'slotsTotal'] } },
          { key: 'lastSeenAt' },
        ],
      },
      {
        metric: 'noEligibleNodeTypes',
        sort: 'problems-first',
        columns: [
          { key: 'key' },
          {
            key: 'noEligibleNode',
            label: 'Eligible node',
            display: { kind: 'status', okText: 'Available', badText: 'None eligible', invert: true },
          },
          { key: 'lastSeenAt' },
        ],
      },
    ],
  },
  uptime: {
    tiles: [{ metric: 'nginxConnections.active' }, { metric: 'nginxRequests' }, { metric: 'tlsDaysLeft' }, { metric: 'httpDuration' }],
    series: [{ title: 'nginx connections by state', metrics: ['nginxConnections'] }],
    tables: [
      {
        metric: 'uptimeTargets',
        sort: 'problems-first',
        columns: [
          { key: 'key' },
          { key: 'up', display: { kind: 'status', okText: 'Up', badText: 'Down' } },
          { key: 'statusCode' },
          { key: 'durationMs' },
          { key: 'tlsDaysLeft' },
          { key: 'failedChecks' },
          { key: 'checks' },
          { key: 'lastError' },
          { key: 'lastSeenAt' },
        ],
      },
    ],
  },
  pipeline: {
    tiles: [{ metric: 'exporterFailed' }, { metric: 'exporterQueueUtilization' }, { metric: 'receiverRefused' }, { metric: 'scrapeTargetsDown' }],
    series: [],
    tables: [
      {
        metric: 'scrapeTargets',
        sort: 'problems-first',
        columns: [{ key: 'key' }, { key: 'up', display: { kind: 'status', okText: 'Up', badText: 'Down' } }, { key: 'lastSeenAt' }],
      },
    ],
  },
});

/**
 * The display kinds a presentation column may use, as a list (documentation and
 * tests).
 *
 * @stability experimental
 */
export const PRESENTATION_COLUMN_DISPLAY_KINDS: readonly string[] = PRESENTATION_COLUMN_DISPLAYS;
