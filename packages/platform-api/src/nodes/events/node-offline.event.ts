// =============================================================================
// `nodes.node.offline`: a worker node was marked offline (issue #734)
// =============================================================================
//
// The fleet sweep (`nodes.fleet.sweep`) flips every node whose heartbeat went
// silent to `offline` in ONE `UPDATE ... RETURNING`, then emits this event once
// per node that statement actually flipped, AFTER it committed and outside any
// transaction. The slice raises no notification itself: the notifications
// slice sits above it, so the app listens and dispatches (the reference app:
// `apps/api/src/notifications/ops/node-offline-notifier.ts`, notification key
// `nodes.node_offline`), the precedent of `job.settled` and the app's
// `JobFailureNotifier`.
//
// ⚠ A LISTENER MUST NOT DO I/O IN ITS BODY beyond a fire-and-forget
// notification dispatch (`apps/api/test/jobs/on-event-no-io.spec.ts`), and
// must not throw: the sweep emits synchronously and has already succeeded.
// =============================================================================

/**
 * The `EventEmitter2` key. Permanent: a listener subscribes by string, so
 * renaming it silently unsubscribes every listener.
 *
 * @stability stable
 */
export const NODE_OFFLINE_EVENT = 'nodes.node.offline';

/**
 * One node the fleet sweep marked offline.
 *
 * @example
 * ```ts
 * @OnEvent(NODE_OFFLINE_EVENT)
 * handle(event: NodeOfflineEvent): void {
 *   void this.notifications.notifyPermissionHolders('nodes.node_offline', 'nodes:read', { ...event }).catch(log);
 * }
 * ```
 *
 * @extensionPoint event
 * @stability stable
 */
export class NodeOfflineEvent {
  /**
   * @param nodeId - the node.
   * @param nodeName - its operator-facing name.
   * @param lastHeartbeatAt - when it was last heard from, or `null` if it never sent a heartbeat.
   * @param markedOfflineAt - when this sweep flipped it.
   * @param staleAfterMinutes - the silence that counts as offline (`staleHeartbeatSeconds x offlineStaleMultiplier`), in whole minutes, at least 1.
   */
  constructor(
    public readonly nodeId: string,
    public readonly nodeName: string,
    public readonly lastHeartbeatAt: Date | null,
    public readonly markedOfflineAt: Date,
    public readonly staleAfterMinutes: number,
  ) {}
}
