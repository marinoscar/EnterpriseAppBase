import {
  ALERT_KIND_IDS,
  nodeEventConfigSchema,
  type AlertObservation,
  type NodeEventConfig,
} from '@marinoscar/platform-contract/alerts';

import type { AlertNodeEventPayload, AlertRuleKind, AlertRuleView } from '../alerts.types';

const SEVERITY_RANK: Record<string, number> = { info: 0, warning: 1, critical: 2 };

/** Most events one evaluation reads. */
const MAX_EVENTS = 2_000;

/**
 * Whether a dotted event type matches one pattern: exact, or `prefix.*`.
 *
 * @param pattern - `power.battery_low` or `power.*`.
 * @param type - the event type.
 * @returns whether it matches.
 *
 * @stability experimental
 */
export function eventTypeMatches(pattern: string, type: string): boolean {
  return pattern.endsWith('.*') ? type.startsWith(pattern.slice(0, -1)) : pattern === type;
}

function typeIn(patterns: readonly string[], type: string): boolean {
  return patterns.some((pattern) => eventTypeMatches(pattern, type));
}

function attrsMatch(wanted: NodeEventConfig['attrs'], attrs: unknown): boolean {
  if (!wanted) return true;
  const have = (attrs && typeof attrs === 'object' ? attrs : {}) as Record<string, unknown>;
  return Object.entries(wanted).every(([key, value]) => String(have[key]) === String(value));
}

/**
 * How a node event relates to a rule: it triggers it, recovers it, or is unrelated (`null`).
 *
 * @stability experimental
 */
export type NodeEventClassification = 'trigger' | 'recovery' | null;

/**
 * Classifies one event against a rule's config.
 *
 * @param config - the rule's parsed config.
 * @param event - the event (type, severity, attrs, node).
 * @returns `trigger`, `recovery` or `null`.
 *
 * @stability experimental
 */
export function classifyNodeEvent(
  config: NodeEventConfig,
  event: { nodeId: string; type: string; severity: string; attrs: unknown },
): NodeEventClassification {
  if (config.nodeIds && config.nodeIds.length > 0 && !config.nodeIds.includes(event.nodeId)) return null;
  if (
    typeIn(config.eventTypes, event.type) &&
    (SEVERITY_RANK[event.severity] ?? 0) >= (SEVERITY_RANK[config.minSeverity ?? 'info'] ?? 0) &&
    attrsMatch(config.attrs, event.attrs)
  ) {
    return 'trigger';
  }
  if (config.recovery && typeIn(config.recovery.eventTypes, event.type) && attrsMatch(config.recovery.attrs, event.attrs)) {
    return 'recovery';
  }
  return null;
}

/**
 * `node_event`: a worker node reported a matching event. Reads the
 * `worker_node_events` table (not the telemetry store), so it works with
 * telemetry off. Per node the NEWEST classified event inside
 * `resolveAfterSeconds` decides: a trigger breaches, a recovery clears, and a
 * node with no such event inside the window is absent (clear).
 *
 * @stability experimental
 */
export const nodeEventKind: AlertRuleKind<NodeEventConfig> = {
  id: ALERT_KIND_IDS.NODE_EVENT,
  label: 'Node event',
  description:
    'A worker node reported a matching event (for example it switched to battery). Clears on a recovery event or after a set time.',
  configSchema: nodeEventConfigSchema,
  eventDriven: true,
  async evaluate(ctx, rule: AlertRuleView<NodeEventConfig>): Promise<AlertObservation[]> {
    const { config } = rule;
    const since = new Date(ctx.now.getTime() - config.resolveAfterSeconds * 1000);
    const patterns = [...config.eventTypes, ...(config.recovery?.eventTypes ?? [])];
    const exact = patterns.filter((p) => !p.endsWith('.*'));
    const prefixes = patterns.filter((p) => p.endsWith('.*')).map((p) => p.slice(0, -1));

    const events = await ctx.db.workerNodeEvent.findMany({
      where: {
        receivedAt: { gte: since },
        OR: [...(exact.length > 0 ? [{ type: { in: exact } }] : []), ...prefixes.map((prefix) => ({ type: { startsWith: prefix } }))],
      },
      orderBy: { receivedAt: 'asc' },
      take: MAX_EVENTS,
    });

    const latest = new Map<string, { kind: Exclude<NodeEventClassification, null>; type: string }>();
    for (const event of events) {
      const kind = classifyNodeEvent(config, event);
      if (kind) latest.set(event.nodeId, { kind, type: event.type });
    }
    if (latest.size === 0) return [];

    const nodes = await ctx.db.workerNode.findMany({ where: { id: { in: [...latest.keys()] } }, select: { id: true, name: true } });
    const names = new Map(nodes.map((node) => [node.id, node.name]));

    return [...latest.entries()].map(([nodeId, state]): AlertObservation => {
      const name = names.get(nodeId) ?? nodeId;
      return {
        labels: { 'node.id': nodeId, 'node.name': name },
        value: null,
        breached: state.kind === 'trigger',
        summary:
          state.kind === 'trigger'
            ? `${rule.name}: node ${name} reported ${state.type}`
            : `${rule.name}: node ${name} recovered (${state.type})`,
      };
    });
  },
  matchesEvent(config, event: AlertNodeEventPayload): boolean {
    return classifyNodeEvent(config, event) !== null;
  },
  describe: (rule) => {
    const { config } = rule;
    const recovery = config.recovery ? `; clears on ${config.recovery.eventTypes.join(', ')}` : '';
    return `A node reports ${config.eventTypes.join(', ')}${recovery}; otherwise clears after ${config.resolveAfterSeconds}s`;
  },
};
