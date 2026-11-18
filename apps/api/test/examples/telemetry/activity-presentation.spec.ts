import { isMetricUnit, metricUnitIds } from '@marinoscar/platform-api/telemetry';
import { checkMetricGroups } from '@marinoscar/platform-api/telemetry/testing';
import { metricGroupPresentationSchema } from '@marinoscar/platform-contract/telemetry';

import { ACTIVITY_METRIC_GROUP, ESTIMATED_USD_PER_MILLION_TOKENS, USD_UNIT } from '../../../src/platform-extensions/telemetry/activity.metric-group';

// =============================================================================
// The reference app's group declares its own presentation and unit (PP-14.18)
// =============================================================================
//
// What the example adds to `activity`: a unit (`usd`), a presentation (tiles in
// an order, status colours on the charts, a top-5 table) and a ratio column. The
// presentation is data; these tests prove it is valid data and that the group
// still passes the conformance checks the platform runs on every group.
// =============================================================================

describe('the "activity" group presentation', () => {
  const presentation = ACTIVITY_METRIC_GROUP.presentation!;

  it('registers the app unit in the registry the group is validated against', () => {
    expect(isMetricUnit('usd')).toBe(true);
    expect(metricUnitIds()).toContain('usd');
    expect(USD_UNIT).toMatchObject({ id: 'usd', format: 'currency', currency: 'USD' });
    expect(USD_UNIT.decimals).toBe(2);
  });

  it('is plain data the schema accepts, with no function in it', () => {
    expect(metricGroupPresentationSchema.safeParse(presentation).success).toBe(true);
    expect(JSON.parse(JSON.stringify(presentation))).toEqual(presentation);
  });

  it('shows the spend tile in dollars, from the same table as the token family', () => {
    const spend = ACTIVITY_METRIC_GROUP.families.find((f) => f.key === 'aiSpend')!;
    const tokens = ACTIVITY_METRIC_GROUP.families.find((f) => f.key === 'aiTokens')!;
    expect(spend.unit).toBe('usd');
    expect(spend.table).toBe(tokens.table);
    expect(spend.scale).toBe(ESTIMATED_USD_PER_MILLION_TOKENS / 1_000_000);
    expect(presentation.tiles?.map((t) => t.metric)).toContain('aiSpend');
  });

  it('declares a top-5 table and a ratio column over its own parts', () => {
    expect(presentation.tables).toEqual([{ metric: 'notificationEvents', topN: 5, sort: 'value-desc' }]);
    expect(presentation.virtualColumns).toEqual([
      expect.objectContaining({ id: 'failureRate', expression: 'ratio', of: ['failed', 'attempts'], table: 'notificationEvents' }),
    ]);
  });

  it('passes the metric-group conformance checks', () => {
    expect(checkMetricGroups([ACTIVITY_METRIC_GROUP])).toEqual([]);
  });
});
