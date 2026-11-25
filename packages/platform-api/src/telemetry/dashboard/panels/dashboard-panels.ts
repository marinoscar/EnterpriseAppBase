// The dashboard-panel registry with the platform's panels already registered:
// import the registry from HERE, never from ./dashboard-panel.registry, so a
// read (or an app registering `api`) sees the built-ins.
import './dashboard-panel.manifest';

export {
  dashboardPanelRegistry,
  isBuiltinDashboardPanel,
  registerDashboardPanel,
  type DashboardPanelContext,
  type DashboardPanelDef,
  type DashboardPanelWindow,
} from './dashboard-panel.registry';
