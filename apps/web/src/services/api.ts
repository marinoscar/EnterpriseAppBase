/**
 * Where the API lives.
 *
 * EXPORTED as of #127. The SSE client (`@marinoscar/platform-web/core`'s `connectSse`) opens a
 * raw `fetch` outside `ApiService.request` — it has to, because that method
 * buffers a JSON body and an event stream never ends — and it must resolve its
 * URL against exactly the same base. A second literal `'/api'` there would be
 * a same-origin assumption that silently breaks the day `VITE_API_BASE_URL` is
 * set, in the one code path that fails by going quiet rather than by erroring.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

import { APP_SLUG } from '@app/shared';

// Issue #258, epic #254. The maintenance recogniser is imported here — and
// nowhere near a page — because the interception is CENTRAL: see `toError`.
import { readMaintenanceBlock, reportMaintenanceBlock } from './maintenance';

import {
  ApiError,
  PlatformHttpClient,
  type PlatformHttpBlobWithHeaders,
  type SessionExpiredListener as PlatformSessionExpiredListener,
} from '@marinoscar/platform-web/core';

/** What `responseType: 'blobWithHeaders'` resolves with. */
export type BlobWithHeaders = PlatformHttpBlobWithHeaders;

/**
 * The Web Lock every page of this app on one origin takes around
 * `POST /auth/refresh`. Derived from the shared identity so two
 * apps built from this template never contend for each other's lock.
 */
export const AUTH_REFRESH_LOCK_NAME = `${APP_SLUG}-auth-refresh`;

/** Called when the server definitively refused to refresh a live session. */
export type SessionExpiredListener = PlatformSessionExpiredListener;

/**
 * The app's transport: `@marinoscar/platform-web/core`'s `PlatformHttpClient`
 * (the token holder, the one-shot 401 -> refresh -> retry and the cross-page
 * refresh lock, moved there by #727) bound to this app's API base, its refresh
 * lock name and its maintenance recogniser.
 *
 * THE MAINTENANCE INTERCEPTION IS CENTRAL (#258, epic #254): every request in
 * this application goes through the client's single error path, which hands
 * each error response to `onErrorResponse` before throwing, so every caller
 * inherits maintenance handling without a line of change. AN ORDINARY 503 IS
 * UNTOUCHED: `readMaintenanceBlock` returns `null` unless the status is 503 AND
 * `details.reason` is the marker (see `services/maintenance.ts`). The error is
 * still THROWN in both cases.
 */
export class ApiService extends PlatformHttpClient {
  constructor() {
    super({
      baseUrl: API_BASE_URL,
      refreshLockName: AUTH_REFRESH_LOCK_NAME,
      onErrorResponse: (status, body) => {
        const block = readMaintenanceBlock(status, body);
        if (block) {
          reportMaintenanceBlock(block);
        }
      },
    });
  }
}

export { ApiError };

export const api = new ApiService();
