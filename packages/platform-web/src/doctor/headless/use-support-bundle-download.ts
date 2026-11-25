// Download the support bundle (`GET /admin/doctor/support-bundle`), issue #772.
//
// The house fetch-hook contract (see use-doctor.ts): a mounted guard on every
// `setState` past an `await`, an API error becomes its message (403 named
// explicitly), and `download` RESOLVES rather than throwing: the caller is a
// click handler and the error has already been captured for rendering.
//
// The file is fetched through the app's transport (`PlatformApiClient.getBlob`,
// so the bearer token, the refresh and the maintenance handling stay the
// app's) and handed to the browser under the name the server chose in
// `Content-Disposition`.

import { useCallback, useState } from 'react';

import { isPlatformApiError, useOptionalPlatformHost } from '../../core/index.js';
import type { PlatformApiClient } from '../../core/index.js';
import { useIsMounted } from '../internal/use-is-mounted.js';

/**
 * The route, relative to the API base, unless `DoctorModule.forRoot({ path })` moved it.
 *
 * @stability experimental
 */
export const SUPPORT_BUNDLE_PATH = '/admin/doctor/support-bundle';

/**
 * What {@link useSupportBundleDownload} takes.
 *
 * @stability experimental
 */
export interface UseSupportBundleDownloadOptions {
  /** The transport. Default: the host's (`usePlatformApi()`). */
  api?: PlatformApiClient;
  /** The route. Default {@link SUPPORT_BUNDLE_PATH}. */
  path?: string;
  /**
   * Hands the file to the browser. Default: an object URL clicked through a
   * hidden anchor. Replace it to save elsewhere, or in a test.
   */
  save?: (blob: Blob, filename: string) => void;
}

/**
 * What {@link useSupportBundleDownload} returns.
 *
 * @stability experimental
 */
export interface UseSupportBundleDownloadReturn {
  /** Fetch the bundle and save it. Resolves even when it fails (see `error`). */
  download: () => Promise<void>;
  /** A download is in flight. */
  isDownloading: boolean;
  /** Why the last download failed, or `null`. */
  error: string | null;
  /** The name of the last file saved, or `null`. */
  filename: string | null;
}

/**
 * The filename from a `Content-Disposition` header (`filename*=UTF-8''…`,
 * `filename="…"` or `filename=…`), or `null`. Path separators are replaced.
 *
 * @param header - the header value, or `null`.
 * @returns the filename, or `null`.
 *
 * @stability experimental
 */
export function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  let name: string | null = null;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (extended?.[1]) {
    try {
      name = decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''));
    } catch {
      name = null;
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
    name = plain ? (plain[2] ?? plain[1] ?? '').trim() : null;
  }
  const safe = name?.replace(/[/\\]/g, '_').trim();
  return safe ? safe : null;
}

/** The default `save`: an object URL clicked through a hidden anchor, revoked afterwards. */
function saveWithAnchor(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Deferred: revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function messageFor(err: unknown): string {
  if (isPlatformApiError(err)) {
    if (err.status === 403) return 'You do not have permission to download the support bundle';
    return err.message || 'Failed to download the support bundle';
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Failed to download the support bundle';
}

/**
 * Downloads the support bundle (the doctor report, versions and a 24-hour
 * telemetry summary, redacted by the API) and saves it under the server's
 * filename (`support-bundle-<slug>-<timestamp>.json`).
 *
 * @param options - the transport, route and save function; every one optional.
 * @returns `download`, the in-flight flag, the last error and the last filename.
 * @throws Error when no `api` is given and no `PlatformHostProvider` is mounted.
 *
 * @example
 * ```tsx
 * const { download, isDownloading, error } = useSupportBundleDownload();
 * <Button onClick={() => void download()} disabled={isDownloading}>Download support bundle</Button>
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useSupportBundleDownload(options: UseSupportBundleDownloadOptions = {}): UseSupportBundleDownloadReturn {
  const host = useOptionalPlatformHost();
  const api = options.api ?? host?.api;
  if (!api) {
    throw new Error(
      'useSupportBundleDownload: no PlatformHostProvider above this component and no api was passed. ' +
        'Mount PlatformHostProvider (from @marinoscar/platform-web/core) or pass { api }.',
    );
  }
  const path = options.path ?? SUPPORT_BUNDLE_PATH;
  const save = options.save ?? saveWithAnchor;

  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const download = useCallback(async () => {
    try {
      setIsDownloading(true);
      setError(null);
      if (typeof api.getBlob !== 'function') {
        throw new Error("This app's transport cannot download files (PlatformApiClient.getBlob is missing)");
      }
      const { blob, headers } = await api.getBlob(path);
      const name = filenameFromContentDisposition(headers.get('Content-Disposition')) ?? 'support-bundle.json';
      save(blob, name);
      if (isMounted()) setFilename(name);
    } catch (err) {
      if (isMounted()) setError(messageFor(err));
    } finally {
      if (isMounted()) setIsDownloading(false);
    }
  }, [api, path, save, isMounted]);

  return { download, isDownloading, error, filename };
}
