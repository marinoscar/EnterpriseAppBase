/**
 * The dashboard-panel view registry (PP-14.18).
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  dashboardPanelViews,
  getDashboardPanelView,
  registerDashboardPanelView,
  resetDashboardPanelViewsForTests,
} from '../../../src/telemetry/ui/components/dashboard/panels/dashboardPanelViews.js';
import { registerPlatformDashboardPanelViews } from '../../../src/telemetry/ui/components/dashboard/panels/builtinPanelViews.js';

const View = () => null;
const Other = () => null;

afterEach(() => {
  resetDashboardPanelViewsForTests();
});

describe('registerDashboardPanelView', () => {
  it('registers a view for a panel id, frame "page" by default', () => {
    registerDashboardPanelView('signups', View);
    expect(getDashboardPanelView('signups')).toMatchObject({
      id: 'signups',
      View,
      frame: 'page',
      builtin: false,
    });
    expect(dashboardPanelViews().map((view) => view.id)).toEqual(['signups']);
  });

  it('takes the "self" frame option', () => {
    registerDashboardPanelView('mine', View, { frame: 'self' });
    expect(getDashboardPanelView('mine')?.frame).toBe('self');
  });

  it('is idempotent for the same component and refuses a different one', () => {
    registerDashboardPanelView('signups', View);
    expect(() => registerDashboardPanelView('signups', View)).not.toThrow();
    expect(() => registerDashboardPanelView('signups', Other)).toThrow(
      /already registered for "signups"/
    );
    expect(() => registerDashboardPanelView('signups', View, { frame: 'self' })).toThrow(
      /already registered/
    );
  });

  it.each(['Signups', 'a', '1x', '../x', 'a b', 'x'.repeat(49), ''])(
    'refuses the malformed id %p',
    (id) => {
      expect(() => registerDashboardPanelView(id, View)).toThrow(/must match/);
    }
  );

  it('refuses something that is not a component', () => {
    expect(() => registerDashboardPanelView('signups', 'alert(1)' as never)).toThrow(
      /React component/
    );
  });
});

describe('the platform views', () => {
  it('register api then logs once, as builtin self-framed views, and an app cannot take their ids', () => {
    registerPlatformDashboardPanelViews();
    registerPlatformDashboardPanelViews();
    expect(dashboardPanelViews().map((view) => [view.id, view.frame, view.builtin])).toEqual([
      ['api', 'self', true],
      ['logs', 'self', true],
    ]);
    expect(() => registerDashboardPanelView('api', View)).toThrow(/already registered/);
  });
});
