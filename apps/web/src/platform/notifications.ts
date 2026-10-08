/**
 * The app's binding of the notifications web slice (issue #738): the
 * transport, the API base URL and the SSE connector, configured once, for its
 * side effect, by `App.tsx` before the first render.
 *
 * The slice's services are plain module functions (logout drops the push
 * subscription through one, outside React), so they reach the API through
 * this configured client rather than the platform host: the same
 * `ApiService` instance as every other call, so a notification request
 * inherits the bearer token, the 401 refresh and the maintenance recogniser.
 */

import { configureNotificationsWeb } from '@marinoscar/platform-web/notifications/headless';

import { API_BASE_URL, api } from '../services/api';
import { connectSse } from '../services/sse';

configureNotificationsWeb({ api, apiBaseUrl: API_BASE_URL, connectSse });
