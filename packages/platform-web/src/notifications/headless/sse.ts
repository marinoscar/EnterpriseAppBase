// The SSE connection the notification stream opens (issue #738): the shape of
// `@marinoscar/platform-web/core`'s `connectSse`, which the app hands in
// through `configureNotificationsWeb({ connectSse })` (bearer token, reconnect
// with backoff, maintenance handling stay the app's).

import { notificationsWebConfig } from './api.js';

/**
 * One dispatched SSE event.
 *
 * @stability experimental
 */
export interface SseFrame {
  /** The `event:` name, or `'message'`. */
  event: string;
  /** The `data:` lines, joined. */
  data: string;
  /** The `id:` field of this frame, or `null`. */
  id: string | null;
}

/**
 * The connection's lifecycle.
 *
 * @stability experimental
 */
export type SseState = 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * What `connectSse` takes.
 *
 * @stability experimental
 */
export interface SseOptions {
  /** The stream URL. */
  url: string;
  /** The current `Authorization` header value, or `null`. */
  authorization: () => string | null;
  /** Refreshes the session after a 401; resolves whether it worked. */
  reauthenticate: () => Promise<boolean>;
  /** Called when the stream opens. */
  onOpen: () => void;
  /** Called per frame. */
  onFrame: (frame: SseFrame) => void;
  /** Called on every state change. */
  onStateChange?: (state: SseState) => void;
}

/**
 * An open connection.
 *
 * @stability experimental
 */
export interface SseConnection {
  /** Closes it for good. */
  close: () => void;
}

/**
 * Opens a connection through the app's configured connector; without one, a
 * closed no-op connection (the inbox still loads, no live frames arrive).
 *
 * @param options - the connection options.
 * @returns the connection.
 *
 * @stability experimental
 */
export function connectSse(options: SseOptions): SseConnection {
  const connect = notificationsWebConfig().connectSse;
  if (!connect) {
    options.onStateChange?.('closed');
    return { close: () => undefined };
  }
  return connect(options);
}
