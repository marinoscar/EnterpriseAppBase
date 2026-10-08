import { ANDROID_APP_ADMIN_PATH, APK_FILE_FIELD } from '@marinoscar/platform-contract/android-app';
import type {
  AdminRelease,
  AndroidAppResponse,
  AndroidAppTestNotificationResponse,
  DownloadLink,
  PublicRelease,
  TrustedAndroidApp,
} from '@marinoscar/platform-contract/android-app';

import type { PlatformApiClient } from '../../core/index.js';

/**
 * The app's transport: the platform client, plus `postFormData` for the APK
 * upload (`PlatformHttpClient` has it).
 *
 * @stability experimental
 */
export type AndroidAppTransport = PlatformApiClient & {
  /** A multipart POST; needed for the upload only. */
  postFormData?<T>(path: string, body: FormData): Promise<T>;
};

/**
 * The fields of a release upload (the file goes separately).
 *
 * @stability experimental
 */
export interface AndroidReleaseUploadInput {
  /** The application id inside the APK. */
  packageName: string;
  /** The human version. */
  versionName: string;
  /** The build number. */
  versionCode: number;
  /** The signing certificate fingerprint. */
  signingSha256: string;
  /** Release notes. */
  notes?: string;
  /** Offer it at once (default true on the server). */
  makeCurrent?: boolean;
  /** Override the not-newer rule. */
  force?: boolean;
  /** Trust a new (package, signing key) pair. */
  trust?: boolean;
}

/**
 * The android-app API calls.
 *
 * @stability experimental
 */
export interface AndroidAppClient {
  /** `GET /admin/android-app`. */
  get(): Promise<AndroidAppResponse>;
  /** `PUT /admin/android-app`. */
  replace(trustedApps: TrustedAndroidApp[]): Promise<AndroidAppResponse>;
  /** `POST /admin/android-app/test-notification`. */
  testNotification(userId?: string): Promise<AndroidAppTestNotificationResponse>;
  /** `GET /admin/android-app/releases`. */
  listReleases(): Promise<AdminRelease[]>;
  /** `POST /admin/android-app/releases` (multipart; the fields go before the file). */
  uploadRelease(input: AndroidReleaseUploadInput, apk: Blob): Promise<AdminRelease>;
  /** `POST /admin/android-app/releases/:id/make-current`. */
  makeCurrent(id: string): Promise<AdminRelease>;
  /** `DELETE /admin/android-app/releases/:id`. */
  deleteRelease(id: string): Promise<void>;
  /** `GET /android-app/releases/latest`. */
  latest(): Promise<PublicRelease>;
  /** `POST /android-app/releases/:id/download-link`. */
  downloadLink(id: string): Promise<DownloadLink>;
}

/**
 * The android-app client over the app's transport.
 *
 * @param api - the app's transport (`usePlatformApi()`, or the app's `PlatformHttpClient`).
 * @returns the client.
 *
 * @example
 * ```ts
 * const client = createAndroidAppClient(usePlatformApi());
 * const { url } = await client.downloadLink(release.id);
 * window.location.assign(url);
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function createAndroidAppClient(api: AndroidAppTransport): AndroidAppClient {
  const releases = `${ANDROID_APP_ADMIN_PATH}/releases`;
  return {
    get: () => api.get<AndroidAppResponse>(ANDROID_APP_ADMIN_PATH),
    replace: (trustedApps) => api.put<AndroidAppResponse>(ANDROID_APP_ADMIN_PATH, { trustedApps }),
    testNotification: (userId) =>
      api.post<AndroidAppTestNotificationResponse>(`${ANDROID_APP_ADMIN_PATH}/test-notification`, userId ? { userId } : {}),
    listReleases: () => api.get<AdminRelease[]>(releases),
    async uploadRelease(input, apk) {
      if (typeof api.postFormData !== 'function') {
        throw new Error('This transport cannot send multipart/form-data: pass a client with postFormData.');
      }
      const form = new FormData();
      // The fields first: the server refuses a bad upload before storing a byte.
      form.append('packageName', input.packageName);
      form.append('versionName', input.versionName);
      form.append('versionCode', String(input.versionCode));
      form.append('signingSha256', input.signingSha256);
      if (input.notes) form.append('notes', input.notes);
      if (input.makeCurrent !== undefined) form.append('makeCurrent', String(input.makeCurrent));
      if (input.force) form.append('force', 'true');
      if (input.trust) form.append('trust', 'true');
      form.append(APK_FILE_FIELD, apk, `${input.packageName}-${input.versionName}.apk`);
      return api.postFormData<AdminRelease>(releases, form);
    },
    makeCurrent: (id) => api.post<AdminRelease>(`${releases}/${encodeURIComponent(id)}/make-current`),
    deleteRelease: async (id) => {
      await api.delete<void>(`${releases}/${encodeURIComponent(id)}`);
    },
    latest: () => api.get<PublicRelease>('/android-app/releases/latest'),
    downloadLink: (id) => api.post<DownloadLink>(`/android-app/releases/${encodeURIComponent(id)}/download-link`),
  };
}
