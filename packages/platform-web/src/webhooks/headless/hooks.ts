// =============================================================================
// The webhooks hooks (issue #1046): reads with a load state, and the writes
// =============================================================================
//
// Every hook takes the scope and talks to that scope's routes only. A failure
// becomes a sentence in `error` (the API's message, or a stable code mapped to
// words); a write resolves with `null` instead of throwing.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { WEBHOOK_ERROR_CODES } from '@marinoscar/platform-contract/webhooks';
import type {
  CreateWebhookEndpointInput,
  RotateWebhookSecretResponse,
  UpdateWebhookEndpoint,
  WebhookDelivery,
  WebhookDeliveryDetail,
  WebhookEndpoint,
  WebhookEndpointCreated,
  WebhookEventCatalogEntry,
  WebhookScope,
  WebhookTestResponse,
} from '@marinoscar/platform-contract/webhooks';

import { isPlatformApiError, usePlatformApi } from '../../core/index.js';
import { createWebhooksApi, type WebhookDeliveriesQuery, type WebhooksApi } from './client.js';
import { groupWebhookEventCatalog, type WebhookEventGroup } from './event-selection.js';

const CODE_MESSAGES: Readonly<Record<string, string>> = {
  [WEBHOOK_ERROR_CODES.WEBHOOK_NOT_FOUND]: 'That webhook endpoint no longer exists.',
  [WEBHOOK_ERROR_CODES.WEBHOOK_DELIVERY_NOT_FOUND]: 'That delivery no longer exists.',
  [WEBHOOK_ERROR_CODES.WEBHOOK_URL_INVALID]: 'Enter a valid https:// URL.',
  [WEBHOOK_ERROR_CODES.WEBHOOK_URL_FORBIDDEN]:
    'That URL points at a private or internal address, which webhooks may not call.',
  [WEBHOOK_ERROR_CODES.WEBHOOK_EVENT_UNKNOWN]: 'One of the selected events does not exist.',
  [WEBHOOK_ERROR_CODES.WEBHOOK_EVENT_NOT_PERMITTED]: 'One of the selected events is not available to you.',
  [WEBHOOK_ERROR_CODES.WEBHOOK_LIMIT_REACHED]: 'The maximum number of webhook endpoints has been reached.',
};

/**
 * A webhook API failure in words: the stable error code's sentence, else the
 * API's message, else `fallback`.
 *
 * @param error - what the call rejected with.
 * @param fallback - the sentence when nothing better is known.
 * @returns the message.
 *
 * @stability experimental
 */
export function webhookErrorMessage(error: unknown, fallback: string): string {
  if (isPlatformApiError(error)) {
    if (typeof error.code === 'string' && CODE_MESSAGES[error.code]) return CODE_MESSAGES[error.code]!;
    if (typeof error.message === 'string' && error.message !== '') return error.message;
  }
  return fallback;
}

function useMounted(): () => boolean {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => mounted.current, []);
}

/**
 * Runs `load` now and on `refresh`, keeping only the newest answer.
 */
function useLoad<T>(load: (() => Promise<T>) | null, fallback: string) {
  const mounted = useMounted();
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(load !== null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!load) return;
    const ticket = ++seq.current;
    setIsLoading(true);
    try {
      const next = await load();
      if (!mounted() || ticket !== seq.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (mounted() && ticket === seq.current) setError(webhookErrorMessage(err, fallback));
    } finally {
      if (mounted() && ticket === seq.current) setIsLoading(false);
    }
  }, [load, fallback, mounted]);

  useEffect(() => {
    if (!load) {
      seq.current += 1;
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    void refresh();
  }, [load, refresh]);

  return { data, isLoading, error, refresh };
}

/**
 * The webhooks client of one scope over the host's transport, memoised.
 *
 * @param scope - `user`, `org` or `system`.
 * @returns the client.
 *
 * @stability experimental
 */
export function useWebhooksApi(scope: WebhookScope): WebhooksApi {
  const api = usePlatformApi();
  return useMemo(() => createWebhooksApi(api, scope), [api, scope]);
}

/**
 * What {@link useWebhookEndpoints} returns.
 *
 * @stability experimental
 */
export interface WebhookEndpointsState {
  /** The endpoints, in the API's order. */
  endpoints: WebhookEndpoint[];
  /** Whether a load is in flight. */
  isLoading: boolean;
  /** A load failure, in words. */
  error: string | null;
  /** Reloads now. */
  refresh: () => Promise<void>;
}

/**
 * The endpoints the caller may see at a scope (`GET <base>`).
 *
 * @param scope - `user`, `org` or `system`.
 * @returns the endpoints and the load state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useWebhookEndpoints(scope: WebhookScope): WebhookEndpointsState {
  const client = useWebhooksApi(scope);
  const load = useCallback(() => client.list(), [client]);
  const { data, isLoading, error, refresh } = useLoad(load, 'Could not load the webhook endpoints.');
  return { endpoints: data?.items ?? [], isLoading, error, refresh };
}

/**
 * What {@link useWebhookEndpoint} returns.
 *
 * @stability experimental
 */
export interface WebhookEndpointState {
  /** The endpoint, once loaded. */
  endpoint: WebhookEndpoint | null;
  /** Whether a load is in flight. */
  isLoading: boolean;
  /** A load failure, in words. */
  error: string | null;
  /** Reloads now. */
  refresh: () => Promise<void>;
}

/**
 * One endpoint (`GET <base>/:id`).
 *
 * @param scope - `user`, `org` or `system`.
 * @param id - the endpoint id, or `null` for none.
 * @returns the endpoint and the load state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useWebhookEndpoint(scope: WebhookScope, id: string | null): WebhookEndpointState {
  const client = useWebhooksApi(scope);
  const load = useMemo(() => (id ? () => client.get(id) : null), [client, id]);
  const { data, isLoading, error, refresh } = useLoad(load, 'Could not load the webhook endpoint.');
  return { endpoint: data, isLoading, error, refresh };
}

/**
 * What {@link useWebhookDeliveries} returns.
 *
 * @stability experimental
 */
export interface WebhookDeliveriesState {
  /** The page of deliveries, newest first. */
  deliveries: WebhookDelivery[];
  /** Deliveries matching the filters, across every page. */
  total: number;
  /** Pages at the requested page size. */
  totalPages: number;
  /** Whether a load is in flight. */
  isLoading: boolean;
  /** A load failure, in words. */
  error: string | null;
  /** Reloads the current page now. */
  refresh: () => Promise<void>;
}

/**
 * One page of an endpoint's deliveries
 * (`GET <base>/:id/deliveries?page&pageSize&status&eventKey`), reloaded when
 * the endpoint, the page or a filter changes.
 *
 * @param scope - `user`, `org` or `system`.
 * @param endpointId - the endpoint, or `null` for none.
 * @param query - the one-based page, page size and filters.
 * @returns the page and the load state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useWebhookDeliveries(
  scope: WebhookScope,
  endpointId: string | null,
  query: WebhookDeliveriesQuery = {},
): WebhookDeliveriesState {
  const client = useWebhooksApi(scope);
  const { page, pageSize, status, eventKey } = query;
  const load = useMemo(
    () =>
      endpointId
        ? () =>
            client.listDeliveries(endpointId, {
              ...(page === undefined ? {} : { page }),
              ...(pageSize === undefined ? {} : { pageSize }),
              ...(status ? { status } : {}),
              ...(eventKey ? { eventKey } : {}),
            })
        : null,
    [client, endpointId, page, pageSize, status, eventKey],
  );
  const { data, isLoading, error, refresh } = useLoad(load, 'Could not load the deliveries.');
  return {
    deliveries: data?.items ?? [],
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 0,
    isLoading,
    error,
    refresh,
  };
}

/**
 * What {@link useWebhookDelivery} returns.
 *
 * @stability experimental
 */
export interface WebhookDeliveryState {
  /** The delivery with its payload and request headers, once loaded. */
  delivery: WebhookDeliveryDetail | null;
  /** Whether a load is in flight. */
  isLoading: boolean;
  /** A load failure, in words. */
  error: string | null;
  /** Reloads now. */
  refresh: () => Promise<void>;
}

/**
 * One delivery with its body and headers (`GET <base>/deliveries/:id`).
 *
 * @param scope - `user`, `org` or `system`.
 * @param deliveryId - the delivery, or `null` for none.
 * @returns the delivery and the load state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useWebhookDelivery(scope: WebhookScope, deliveryId: string | null): WebhookDeliveryState {
  const client = useWebhooksApi(scope);
  const load = useMemo(() => (deliveryId ? () => client.getDelivery(deliveryId) : null), [client, deliveryId]);
  const { data, isLoading, error, refresh } = useLoad(load, 'Could not load the delivery.');
  return { delivery: data, isLoading, error, refresh };
}

/**
 * What {@link useWebhookEventCatalog} returns.
 *
 * @stability experimental
 */
export interface WebhookEventCatalogState {
  /** The events the caller may subscribe to, in catalog order. */
  entries: WebhookEventCatalogEntry[];
  /** The same, grouped for the picker. */
  groups: WebhookEventGroup[];
  /** Whether the load is in flight. */
  isLoading: boolean;
  /** A load failure, in words. */
  error: string | null;
}

/**
 * The event catalog of a scope (`GET <base>/events`), already filtered by the
 * API to what the caller may subscribe to.
 *
 * @param scope - `user`, `org` or `system`.
 * @param options - `enabled: false` skips the request (a read-only viewer never opens the picker).
 * @returns the catalog and the load state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useWebhookEventCatalog(scope: WebhookScope, options: { enabled?: boolean } = {}): WebhookEventCatalogState {
  const enabled = options.enabled ?? true;
  const client = useWebhooksApi(scope);
  const load = useMemo(() => (enabled ? () => client.eventCatalog() : null), [client, enabled]);
  const { data, isLoading, error } = useLoad(load, 'Could not load the available events.');
  const entries = useMemo(() => data?.items ?? [], [data]);
  const groups = useMemo(() => groupWebhookEventCatalog(entries), [entries]);
  return { entries, groups, isLoading, error };
}

/**
 * What {@link useWebhookMutations} returns. Each action resolves with the
 * API's answer, or `null` when it refused (see `error`).
 *
 * @stability experimental
 */
export interface WebhookMutations {
  /** `POST <base>`: the endpoint and its secret, shown once. */
  create: (input: CreateWebhookEndpointInput) => Promise<WebhookEndpointCreated | null>;
  /** `PATCH <base>/:id`. */
  update: (id: string, patch: UpdateWebhookEndpoint) => Promise<WebhookEndpoint | null>;
  /** `DELETE <base>/:id`; resolves `true` on success. */
  remove: (id: string) => Promise<boolean>;
  /** `POST <base>/:id/rotate-secret`: the new secret, shown once. */
  rotateSecret: (id: string) => Promise<RotateWebhookSecretResponse | null>;
  /** `POST <base>/:id/test`: the queued ping delivery. */
  sendTest: (id: string) => Promise<WebhookTestResponse | null>;
  /** `POST <base>/deliveries/:id/redeliver`; resolves `true` on success. */
  redeliver: (deliveryId: string) => Promise<boolean>;
  /** Whether a write is in flight. */
  pending: boolean;
  /** The last refusal, in words. */
  error: string | null;
  /** Clears `error`. */
  reset: () => void;
}

/**
 * The webhook writes of one scope, with one shared pending flag and error.
 *
 * @param scope - `user`, `org` or `system`.
 * @returns the actions and their state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useWebhookMutations(scope: WebhookScope): WebhookMutations {
  const client = useWebhooksApi(scope);
  const mounted = useMounted();
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(call: () => Promise<T>, fallback: string): Promise<T | null> => {
      setPendingCount((count) => count + 1);
      setError(null);
      try {
        return await call();
      } catch (err) {
        if (mounted()) setError(webhookErrorMessage(err, fallback));
        return null;
      } finally {
        if (mounted()) setPendingCount((count) => count - 1);
      }
    },
    [mounted],
  );

  return {
    create: useCallback((input) => run(() => client.create(input), 'The endpoint could not be created.'), [client, run]),
    update: useCallback((id, patch) => run(() => client.update(id, patch), 'The endpoint could not be saved.'), [client, run]),
    remove: useCallback(
      async (id) => (await run(async () => (await client.remove(id), true), 'The endpoint could not be deleted.')) === true,
      [client, run],
    ),
    rotateSecret: useCallback((id) => run(() => client.rotateSecret(id), 'The secret could not be rotated.'), [client, run]),
    sendTest: useCallback((id) => run(() => client.sendTest(id), 'The test event could not be sent.'), [client, run]),
    redeliver: useCallback(
      async (deliveryId) =>
        (await run(async () => (await client.redeliver(deliveryId), true), 'The delivery could not be queued again.')) === true,
      [client, run],
    ),
    pending: pendingCount > 0,
    error,
    reset: useCallback(() => setError(null), []),
  };
}
