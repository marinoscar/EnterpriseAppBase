// =============================================================================
// The nodes slice's API client (issue #881)
// =============================================================================
//
// Every admin route of the worker fleet the packaged page calls, over the app's
// `PlatformApiClient` (the shell's transport, which unwraps the `{ data }`
// envelope and attaches the bearer token). Moved from the jobs slice's client
// (#854), whose `JobsApi` now extends {@link NodesApi}.
//
// `JwtAuthGuard` admits a `nod_` worker credential on `/api/nodes` and nothing
// else (#267): `admin/nodes` publishes other operators' email addresses and
// deletes other people's nodes, and a worker token that could reach its own
// administration would be an escalation. Minting a credential is
// `POST /node-credentials`, the one route outside `/admin/nodes` this client
// calls.
//
// `GET /admin/nodes` returns the whole fleet as a bare array, not a page: a
// fleet is tens of machines, and the page tallies its health verdicts.
// =============================================================================

import type { PlatformApiClient } from '../../core/index.js';
import type { CreateNodeCredentialInput, NodeCredential, NodeCredentialCreated, WorkerNode } from './types.js';

/**
 * Every call the worker-node page and hooks make. `createNodesApi` builds one
 * over the app's transport; a test or an app with its own client implements it.
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface NodesApi {
  /** `GET /admin/nodes`: the whole fleet with derived health and job counts. */
  getWorkerNodes(): Promise<WorkerNode[]>;
  /** `GET /admin/nodes/:id`: one node, in the list's shape. */
  getWorkerNode(id: string): Promise<WorkerNode>;
  /** `DELETE /admin/nodes/:id`: forgets the node; its jobs are released, its credential is not revoked. */
  deleteWorkerNode(id: string): Promise<void>;
  /** `GET /admin/nodes/credentials`: every credential, newest first, revoked ones included. */
  getNodeCredentials(): Promise<NodeCredential[]>;
  /** `POST /node-credentials`: mints one and returns the raw token EXACTLY ONCE. */
  createNodeCredential(input: CreateNodeCredentialInput): Promise<NodeCredentialCreated>;
  /** `DELETE /admin/nodes/credentials/:id`: effective on the node's next request; one-way. */
  revokeNodeCredential(id: string): Promise<void>;
}

/**
 * The worker-node client over the app's transport.
 *
 * @param client - the app's {@link PlatformApiClient} (`usePlatformApi()`, or the app's own adapter).
 * @returns a {@link NodesApi} whose calls go through `client`.
 *
 * @example
 * ```ts
 * // apps/web/src/platform/nodesAdapters.ts
 * export const appNodesAdapters: NodesWebAdapters = { DataTable, Spinner: LoadingSpinner, api: createNodesApi(appPlatformApi) };
 * ```
 *
 * @stability experimental
 */
export function createNodesApi(client: PlatformApiClient): NodesApi {
  return {
    getWorkerNodes: () => client.get<WorkerNode[]>('/admin/nodes'),
    getWorkerNode: (id) => client.get<WorkerNode>(`/admin/nodes/${id}`),
    deleteWorkerNode: async (id) => {
      await client.delete<void>(`/admin/nodes/${id}`);
    },
    getNodeCredentials: () => client.get<NodeCredential[]>('/admin/nodes/credentials'),
    createNodeCredential: (input) => {
      const body: CreateNodeCredentialInput = { name: input.name };
      if (input.expiresInDays !== undefined) body.expiresInDays = input.expiresInDays;
      return client.post<NodeCredentialCreated>('/node-credentials', body);
    },
    revokeNodeCredential: async (id) => {
      await client.delete<void>(`/admin/nodes/credentials/${id}`);
    },
  };
}
