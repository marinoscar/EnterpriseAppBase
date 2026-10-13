import { RegistryError, withTemporaryEntries } from '../../../core/index';
import { dashboardPanelRegistry, isBuiltinDashboardPanel, registerDashboardPanel, type DashboardPanelDef } from './dashboard-panels';

// =============================================================================
// The dashboard-panel registry (PP-14.18)
// =============================================================================

const SIGNUPS: DashboardPanelDef = { id: 'signups', label: 'Sign-ups', order: 100, data: () => ({ total: 3 }) };

function refused(fn: () => void): RegistryError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RegistryError);
    return err as RegistryError;
  }
  throw new Error('expected the registration to be refused');
}

describe('the dashboard-panel registry', () => {
  it('holds the platform panels api and logs, registered like an app panel, api first', () => {
    expect(dashboardPanelRegistry.ids()).toEqual(['api', 'logs']);
    expect(dashboardPanelRegistry.list().map((panel) => [panel.id, panel.label, panel.order])).toEqual([
      ['api', 'API requests', 10],
      ['logs', 'Log severity', 20],
    ]);
    expect(isBuiltinDashboardPanel('api')).toBe(true);
    expect(isBuiltinDashboardPanel('signups')).toBe(false);
  });

  it('the platform panels answer with the platform timeseries of the window', async () => {
    const timeseries = jest.fn(async (panel: string) => ({ panel }));
    for (const id of ['api', 'logs']) {
      await dashboardPanelRegistry.get(id)!.data({ timeseries } as never);
    }
    expect(timeseries.mock.calls).toEqual([['api'], ['logs']]);
  });

  it('adds an app panel, ordered by `order` then id', async () => {
    await withTemporaryEntries(dashboardPanelRegistry, [], () => {
      registerDashboardPanel({ ...SIGNUPS, id: 'b-panel', order: 100 });
      registerDashboardPanel({ ...SIGNUPS, id: 'a-panel', order: 100 });
      registerDashboardPanel({ ...SIGNUPS, id: 'first', order: 5 });
      expect(dashboardPanelRegistry.ids()).toEqual(['first', 'api', 'logs', 'a-panel', 'b-panel']);
    });
    expect(dashboardPanelRegistry.ids()).toEqual(['api', 'logs']);
  });

  it('refuses an app panel that reuses a platform id, a bad id and a bad definition', async () => {
    await withTemporaryEntries(dashboardPanelRegistry, [], () => {
      expect(refused(() => registerDashboardPanel({ ...SIGNUPS, id: 'api' })).code).toBe('DUPLICATE_ID');
      for (const id of ['Signups', 'a', '1x', '../x', 'a b', 'x'.repeat(49)]) {
        expect(refused(() => registerDashboardPanel({ ...SIGNUPS, id })).code).toBe('INVALID_ID');
      }
      expect(refused(() => registerDashboardPanel({ ...SIGNUPS, label: '' })).code).toBe('INVALID_ENTRY');
      expect(refused(() => registerDashboardPanel({ ...SIGNUPS, label: 'x'.repeat(81) })).code).toBe('INVALID_ENTRY');
      expect(refused(() => registerDashboardPanel({ ...SIGNUPS, order: Number.NaN })).code).toBe('INVALID_ENTRY');
      expect(refused(() => registerDashboardPanel({ ...SIGNUPS, data: 'alert(1)' as never })).code).toBe('INVALID_ENTRY');
      expect(dashboardPanelRegistry.has('signups')).toBe(false);
    });
  });

  it('is frozen with the other registries', async () => {
    await withTemporaryEntries(dashboardPanelRegistry, [], () => {
      dashboardPanelRegistry.freeze();
      expect(refused(() => registerDashboardPanel(SIGNUPS)).code).toBe('FROZEN');
    });
  });
});
