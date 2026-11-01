// =============================================================================
// `nodes.node.event`: a worker node reported an event about itself (issue #1045)
// =============================================================================
//
// A heartbeat may carry events the node observed (power source changed, battery
// low, woke from sleep). `NodeEventsService` persists them to
// `worker_node_events`, then emits this event once per ACCEPTED row, AFTER the
// write committed and outside any transaction. The slice raises no
// notification itself: the notifications slice sits above it, so the app
// listens and dispatches, exactly as it does for `nodes.node.offline`.
//
// ⚠ A LISTENER MUST NOT DO I/O IN ITS BODY beyond a fire-and-forget
// notification dispatch (`on-event-no-io` conformance suite), and must not
// throw: the heartbeat has already succeeded. The payload is the node's
// self-report: untrusted, bounded by `nodeEventSchema`, never a credential.
// =============================================================================

/**
 * The `EventEmitter2` key. Permanent: a listener subscribes by string, so
 * renaming it silently unsubscribes every listener.
 *
 * @stability stable
 */
export const NODE_EVENT_REPORTED = 'nodes.node.event';

/**
 * One event a node reported and the server accepted.
 *
 * @example
 * ```ts
 * @OnEvent(NODE_EVENT_REPORTED)
 * handle(event: NodeEventReportedEvent): void {
 *   if (event.severity === 'critical') void this.notifications.notifyUser(event.ownerUserId, 'nodes.node_event', { ...event }).catch(log);
 * }
 * ```
 *
 * @extensionPoint event
 * @stability experimental
 */
export class NodeEventReportedEvent {
  /**
   * @param nodeId - the node.
   * @param nodeName - its operator-facing name.
   * @param ownerUserId - the user whose credential registered the node, or `null` when unknown.
   * @param type - the dotted event type, e.g. `power.battery_low`.
   * @param severity - `info`, `warning` or `critical`.
   * @param attrs - the node's scalar attributes, `{}` when none.
   * @param occurredAt - when it happened (the node's clock, clamped to the server's window).
   */
  constructor(
    public readonly nodeId: string,
    public readonly nodeName: string,
    public readonly ownerUserId: string | null,
    public readonly type: string,
    public readonly severity: 'info' | 'warning' | 'critical',
    public readonly attrs: Readonly<Record<string, string | number | boolean>>,
    public readonly occurredAt: Date,
  ) {}
}
