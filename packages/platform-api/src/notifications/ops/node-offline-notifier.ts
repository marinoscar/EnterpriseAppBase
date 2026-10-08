// =============================================================================
// NodeOfflineNotifier — `nodes.node_offline` (issue #288; listener since #734)
// =============================================================================
//
// The fleet sweep (`nodes.fleet.sweep`, `@marinoscar/platform-api/nodes`)
// flips silent nodes to `offline` in one `UPDATE ... RETURNING` and, AFTER
// that write commits and outside any transaction, emits `nodes.node.offline`
// once per node it flipped. Until the nodes slice was packaged it called
// `NotificationsService` itself; a package cannot import the app's
// notifications slice (and the nodes slice sits below it), so it emits and
// this listener dispatches. The notification is unchanged: event key
// `nodes.node_offline`, audience `nodes:read` (the exact string the nodes
// admin controller enforces), template `NodeOfflineEmailData`.
//
// Same rules as `JobFailureNotifier` beside it (read its header):
//   - `EventEmitter2` dispatches synchronously, inside the sweep's job: the
//     DETACHED `notifyPermissionHolders` only, never an awaited send;
//   - the whole body is caught, so a bad payload cannot reach the sweep;
//   - `.catch()` on the dispatch despite its never-reject contract, because
//     an unhandled rejection here has no caller to surface it.
//
// It is the documented exception of `apps/api/test/jobs/on-event-no-io.spec.ts`
// (a fire-and-forget notification dispatch, not I/O worth a job).
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { NODE_OFFLINE_EVENT, type NodeOfflineEvent } from '../../nodes/index';

import { PERMISSIONS } from '../notifications.constants';
import type { NodeOfflineEmailData } from '../../email/index';
import { describeThrown } from '../describe-thrown';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class NodeOfflineNotifier {
  private readonly logger = new Logger(NodeOfflineNotifier.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  @OnEvent(NODE_OFFLINE_EVENT)
  handleNodeOffline(event: NodeOfflineEvent): void {
    try {
      // ANNOTATED WITH THE TEMPLATE'S OWN TYPE ON PURPOSE:
      // `notifyPermissionHolders` takes `data: unknown`, so this annotation is
      // the ONLY place the payload's shape is checked at all.
      const payload: NodeOfflineEmailData = {
        nodeId: event.nodeId,
        nodeName: event.nodeName,
        lastHeartbeatAt: event.lastHeartbeatAt,
        markedOfflineAt: event.markedOfflineAt,
        staleAfterMinutes: event.staleAfterMinutes,
        appUrl: this.appUrl(),
      };

      void this.notifications
        .notifyPermissionHolders('nodes.node_offline', PERMISSIONS.NODES_READ, payload)
        .catch((err: unknown) => {
          this.logger.error(
            `Dispatching 'nodes.node_offline' for ${event.nodeId} rejected, which ` +
              `the dispatcher contracts never to do: ${describeThrown(err)}`,
          );
        });
    } catch (err) {
      this.logger.error(
        `Could not raise 'nodes.node_offline' for node ${event.nodeId}; the node is ` +
          `still marked offline: ${describeThrown(err)}`,
      );
    }
  }

  /** The application root, trailing slashes trimmed, or `undefined` (the template then omits its CTA). */
  private appUrl(): string | undefined {
    const appUrl = this.config.get<string>('appUrl');
    return appUrl ? appUrl.replace(/\/+$/, '') : undefined;
  }
}
