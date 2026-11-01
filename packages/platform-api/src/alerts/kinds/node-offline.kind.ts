import { ALERT_KIND_IDS, emptyAlertConfigSchema, type AlertObservation } from '@marinoscar/platform-contract/alerts';

import type { AlertRuleKind } from '../alerts.types';
import { deriveNodeHealth } from '../../nodes/index';

/**
 * `node_offline`: a worker node is stale or offline, by the same rule the
 * fleet page uses (`deriveNodeHealth`). A node an operator DISABLED is left
 * out (disabling is intent, not failure). A node that deregistered gracefully
 * is `offline` too and alerts until the fleet's offline retention prunes it.
 *
 * @stability experimental
 */
export const nodeOfflineKind: AlertRuleKind<Record<string, never>> = {
  id: ALERT_KIND_IDS.NODE_OFFLINE,
  label: 'Node offline',
  description: 'A worker node stopped heartbeating (stale) or was marked offline.',
  configSchema: emptyAlertConfigSchema as unknown as AlertRuleKind<Record<string, never>>['configSchema'],
  async evaluate(ctx, rule): Promise<AlertObservation[]> {
    const staleSeconds = await ctx.staleHeartbeatSeconds();
    const nodes = await ctx.db.workerNode.findMany({
      where: { status: { not: 'disabled' } },
      select: { id: true, name: true, status: true, lastHeartbeatAt: true },
      take: 1_000,
    });
    return nodes.map((node): AlertObservation => {
      const health = deriveNodeHealth(
        { status: node.status, lastHeartbeatAt: node.lastHeartbeatAt },
        staleSeconds,
        ctx.now,
      );
      const breached = health !== 'healthy';
      return {
        labels: { 'node.id': node.id, 'node.name': node.name },
        value: breached ? 1 : 0,
        breached,
        summary: breached
          ? `${rule.name}: node ${node.name} is ${health}${node.lastHeartbeatAt ? ` (last heartbeat ${node.lastHeartbeatAt.toISOString()})` : ' (never sent a heartbeat)'}`
          : `${rule.name}: node ${node.name} is healthy`,
      };
    });
  },
  describe: () => 'A worker node is stale or offline',
};
