// =============================================================================
// Metric-group manifest (issue #680)
// =============================================================================
//
// The one explicit, grep-able list of the Telemetry Dashboard's metric groups,
// registered at import time (common/registry/README.md, "Recipe: a static
// registry"). Platform groups first, in the dashboard's historic order, then
// the app's own (`app-registrations/telemetry.ts`), so a collision names the
// app. Imported by `metric-catalog.ts`; nothing else imports this file.
// =============================================================================

import { APP_METRIC_GROUPS } from '../../app-registrations/telemetry';
import { DATABASE_METRIC_GROUP } from './groups/database.metric-group';
import { HOST_METRIC_GROUP } from './groups/host.metric-group';
import { NODES_METRIC_GROUP } from './groups/nodes.metric-group';
import { PIPELINE_METRIC_GROUP } from './groups/pipeline.metric-group';
import { QUEUE_METRIC_GROUP } from './groups/queue.metric-group';
import { UPTIME_METRIC_GROUP } from './groups/uptime.metric-group';
import { registerMetricGroups } from './metric-group.registry';

registerMetricGroups([
  HOST_METRIC_GROUP,
  DATABASE_METRIC_GROUP,
  QUEUE_METRIC_GROUP,
  NODES_METRIC_GROUP,
  UPTIME_METRIC_GROUP,
  PIPELINE_METRIC_GROUP,
]);

// App-owned groups last.
registerMetricGroups(APP_METRIC_GROUPS);
