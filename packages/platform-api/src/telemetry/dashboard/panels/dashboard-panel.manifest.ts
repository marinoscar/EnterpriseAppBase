// =============================================================================
// Dashboard-panel manifest (PP-14.18)
// =============================================================================
//
// The platform's own panels, registered at import time through the same
// `registerDashboardPanel` an app uses: `api` (status classes and p95 per
// bucket) and `logs` (severity bands per bucket). Their data is the platform's
// timeseries for the window, so `GET .../panels/api` answers what
// `GET .../timeseries?panel=api` does. An app's panels follow, from its own
// registration file. Imported by `dashboard-panels.ts`, which is what the
// slice's index and the panel service import.
// =============================================================================

import { registerDashboardPanel } from './dashboard-panel.registry';

registerDashboardPanel({
  id: 'api',
  label: 'API requests',
  order: 10,
  data: (ctx) => ctx.timeseries('api'),
});

registerDashboardPanel({
  id: 'logs',
  label: 'Log severity',
  order: 20,
  data: (ctx) => ctx.timeseries('logs'),
});
