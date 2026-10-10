/**
 * Load, save, test and provision the deployment's object-storage
 * configuration. Issue #376, epic #372.
 *
 * The house hook contract, as `usePushConfig` and `useEmailSettings` state it:
 *
 *   - TWO SEPARATE FLAG GROUPS. `save` is the ordinary edit and owns
 *     `isSaving`/`saveError`. `test` and `createBucket` are PROBES — they save
 *     nothing, only one is ever in flight, and they share `isProbing` plus
 *     their own result slots. Folding them together would make the Save button
 *     spin while a connection test runs, and would let a save error and a
 *     provider diagnosis overwrite each other.
 *   - EVERY WRITE RESOLVES `true`/`false` RATHER THAN THROWING. Every caller is
 *     a click handler that needs to branch, and the error has already been
 *     captured for rendering.
 *   - `useIsMounted()` GUARDS EVERY `setState` PAST AN `await`.
 *
 * ⚠ THE TWO PROBES NEVER REJECT ON A BAD ANSWER. `POST /test` and
 * `POST /bucket` both answer HTTP 200 carrying a diagnosis — a refused
 * `HeadBucket`, a credential with no `s3:CreateBucket`. Those are the results
 * this page exists to show, so they land in `testResult` / `bucketResult` like
 * any other. A rejection here means the CALL failed (403, 500, the connection
 * dropped), and is rendered as `probeError`. Getting this backwards is how a
 * page announces that storage works over a bucket it could not reach.
 *
 * ⚠ THE 409 IS TWO DIFFERENT ANSWERS. A version mismatch means somebody else
 * saved while this form was open — reload and re-apply. `STORAGE_LOCATION_IN_USE`
 * means the save is CORRECT but would strand existing objects — the page
 * confirms and re-sends. `save` distinguishes them by `ApiError.code` and
 * reports the second through `switchRequired` rather than as a failure the
 * admin has to decode from a message.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isPlatformApiError, useOptionalPlatformHost } from '../../core/index.js';
import type { PlatformApiClient } from '../../core/index.js';
import { STORAGE_LOCATION_IN_USE_CODE, createStorageConfigClient } from './storage-config.js';
import type {
  StorageBucketProvisionResult,
  StorageConfigInput,
  StorageConfigView,
  StorageConnectionTestResult,
  StorageLocationInUseDetails,
} from './storage-config.js';

/** A mounted guard for every `setState` past an `await`. */
function useIsMounted(): () => boolean {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => mounted.current, []);
}

/** 403 is named explicitly — it is the one failure an admin can act on themselves. */
function messageFor(err: unknown, fallback: string): string {
  if (isPlatformApiError(err)) {
    if (err.status === 403) {
      return 'You do not have permission to manage the storage configuration';
    }
    return err.message || fallback;
  }
  return fallback;
}

/**
 * What `save` reports when the API refused for want of the typed confirmation.
 *
 * @stability experimental
 */
export interface StorageSwitchRequired {
  /** The API's message. */
  message: string;
  /** `null` when the API answered without the structured `details` block. */
  details: StorageLocationInUseDetails | null;
}

/**
 * Options of {@link useStorageConfig}.
 *
 * @stability experimental
 */
export interface UseStorageConfigOptions {
  /** The transport. Default: the `PlatformHostProvider`'s (keep its identity stable). */
  api?: PlatformApiClient;
}

/**
 * What {@link useStorageConfig} returns.
 *
 * @stability experimental
 */
export interface UseStorageConfigReturn {
  /** The stored configuration, or `null` until loaded. */
  config: StorageConfigView | null;
  /** Whether a load is in flight. */
  isLoading: boolean;
  /** Failure to LOAD. Distinct from the write errors: "nothing to show" vs. "your change did not stick". */
  loadError: string | null;

  /** Whether a save is in flight. */
  isSaving: boolean;
  /** Why the last save did not land, or `null`. */
  saveError: string | null;
  /**
   * Set when the last save was refused with `STORAGE_LOCATION_IN_USE`. NOT an
   * error — the save is legitimate and the API is asking for the typed word.
   */
  switchRequired: StorageSwitchRequired | null;
  /** Clears `switchRequired`. */
  clearSwitchRequired: () => void;
  /**
   * `PUT`. Pass `confirmSwitch` to re-send with the `SWITCH` literal after the
   * admin has typed it. Resolves `true` when the save landed.
   */
  save: (input: StorageConfigInput, options?: { confirmSwitch?: boolean }) => Promise<boolean>;
  /** Clears `saveError`. */
  clearSaveError: () => void;

  /** True while EITHER probe is in flight — only one ever is. */
  isProbing: boolean;
  /** The last failure of the probe CALL itself (403, 500, dropped). Never a diagnosis. */
  probeError: string | null;
  /** Clears `probeError`. */
  clearProbeError: () => void;
  /** The last connection test, pass or fail, until the page clears it. */
  testResult: StorageConnectionTestResult | null;
  /** Clears `testResult`. */
  clearTestResult: () => void;
  /** The last bucket-creation attempt, whatever its outcome. */
  bucketResult: StorageBucketProvisionResult | null;
  /** Clears `bucketResult`. */
  clearBucketResult: () => void;
  /** Runs the connection test against `input` (saved or not); the diagnosis lands in `testResult`. */
  test: (input: StorageConfigInput) => Promise<void>;
  /** Creates and hardens the bucket `input` names; the outcome lands in `bucketResult`. */
  createBucket: (input: StorageConfigInput) => Promise<void>;

  /** Reloads the configuration. */
  refresh: () => Promise<void>;
}

/**
 * Load, save, test and provision the deployment's object-storage
 * configuration (`storage_config:read` to load, `storage_config:write` for the
 * rest). See the file header for the 409 and probe contracts.
 *
 * @param options - the transport, when the hook runs outside the host provider.
 * @returns the configuration, the flags and the actions.
 * @throws Error when there is neither a host nor an `api` option.
 *
 * @example
 * ```tsx
 * const { config, save, test, testResult } = useStorageConfig();
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useStorageConfig(options: UseStorageConfigOptions = {}): UseStorageConfigReturn {
  const host = useOptionalPlatformHost();
  const api = options.api ?? host?.api;
  if (!api) {
    throw new Error('useStorageConfig needs a transport: mount PlatformHostProvider (@marinoscar/platform-web/core) or pass { api }.');
  }
  const client = useMemo(() => createStorageConfigClient(api), [api]);

  const [config, setConfig] = useState<StorageConfigView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [switchRequired, setSwitchRequired] = useState<StorageSwitchRequired | null>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<StorageConnectionTestResult | null>(null);
  const [bucketResult, setBucketResult] = useState<StorageBucketProvisionResult | null>(null);

  const isMounted = useIsMounted();

  const fetchConfig = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const data = await client.get();
      if (isMounted()) setConfig(data);
    } catch (err) {
      if (isMounted()) {
        setLoadError(messageFor(err, 'Failed to load the storage configuration'));
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [client, isMounted]);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  /**
   * `PUT`, adopting whatever the server says the configuration now is.
   *
   * THE RESPONSE IS THE NEW BASELINE, never the input: the server owns
   * `secretStatus`, `effectiveEndpoint`, `configured`, `missing` and `version`.
   * The secret status in particular must come back from the server — a page
   * still holding `configured: false` after a save that set the key for the
   * first time would keep telling the admin nothing is stored while something
   * is. And `version` is the number the NEXT save must send as `If-Match`, so
   * two saves in a row work with no reload in between.
   */
  const save = useCallback(
    async (
      input: StorageConfigInput,
      options: { confirmSwitch?: boolean } = {},
    ): Promise<boolean> => {
      try {
        setIsSaving(true);
        setSaveError(null);
        setSwitchRequired(null);
        // `?? 0` rather than omitting the header: 0 is the API's way of
        // asserting "I believe nothing is stored yet", so even the first save
        // on a fresh deployment is guarded.
        const data = await client.update(input, config?.version ?? 0, options);
        if (isMounted()) setConfig(data);
        return true;
      } catch (err) {
        if (isPlatformApiError(err) && err.status === 409) {
          // THE SAVE IS FINE, THE APP IS ASKING FOR A WORD. Not an error, not a
          // reload — re-sending the identical body with the confirmation is the
          // whole remedy, so the form must be left exactly as the admin left it.
          if (err.code === STORAGE_LOCATION_IN_USE_CODE) {
            if (isMounted()) {
              setSwitchRequired({
                message: err.message,
                details: (err.details as StorageLocationInUseDetails | undefined) ?? null,
              });
            }
            return false;
          }
          // A VERSION MISMATCH IS THE OTHER 409. Somebody else saved between
          // this page's load and this click, so every retry would 409
          // identically until the form is rebuilt from the current row. Reload
          // it and say plainly that the fields on screen have been replaced — a
          // message alone, over a form still holding stale values, invites the
          // admin to press Save again and (version now current) overwrite the
          // colleague's change for real.
          await fetchConfig();
          if (isMounted()) {
            setSaveError(
              'Someone else changed the storage configuration while you were editing. ' +
                'The form has been reloaded with the current configuration — review it and save again.',
            );
          }
          return false;
        }
        if (isMounted()) {
          setSaveError(messageFor(err, 'Failed to save the storage configuration'));
        }
        return false;
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [client, config, fetchConfig, isMounted],
  );

  /**
   * Run one probe, and keep the two kinds of failure apart.
   *
   * A resolved promise carries the DIAGNOSIS and is handed to `onResult`
   * whatever it says. A rejection means the call itself failed and becomes
   * `probeError` — never a fabricated result, which would put words in the
   * provider's mouth.
   */
  const runProbe = useCallback(
    async <T,>(
      operation: () => Promise<T>,
      onResult: (result: T) => void,
      fallback: string,
    ): Promise<void> => {
      try {
        setIsProbing(true);
        setProbeError(null);
        const result = await operation();
        if (isMounted()) onResult(result);
      } catch (err) {
        if (isMounted()) setProbeError(messageFor(err, fallback));
      } finally {
        if (isMounted()) setIsProbing(false);
      }
    },
    [isMounted],
  );

  const test = useCallback(
    async (input: StorageConfigInput) => {
      // The previous bucket attempt described a different question; leaving it
      // beside a fresh test invites reading one as the other's explanation.
      setBucketResult(null);
      setTestResult(null);
      await runProbe(
        () => client.test(input),
        setTestResult,
        'The connection test could not be run',
      );
    },
    [client, runProbe],
  );

  const createBucket = useCallback(
    async (input: StorageConfigInput) => {
      setBucketResult(null);
      await runProbe(
        () => client.provisionBucket(input),
        (result) => {
          setBucketResult(result);
          // The test that offered this button described a bucket that no
          // longer exists in the same state. Clearing it stops a stale
          // "bucket missing" sitting under a "bucket created" — and stops the
          // Create button being offered a second time on evidence that has
          // been superseded. The admin re-tests to learn the new truth.
          if (result.outcome === 'created' || result.outcome === 'already_exists') {
            setTestResult(null);
          }
        },
        'The bucket could not be created',
      );
    },
    [client, runProbe],
  );

  const clearSaveError = useCallback(() => setSaveError(null), []);
  const clearSwitchRequired = useCallback(() => setSwitchRequired(null), []);
  const clearProbeError = useCallback(() => setProbeError(null), []);
  const clearTestResult = useCallback(() => setTestResult(null), []);
  const clearBucketResult = useCallback(() => setBucketResult(null), []);

  return {
    config,
    isLoading,
    loadError,
    isSaving,
    saveError,
    switchRequired,
    clearSwitchRequired,
    save,
    clearSaveError,
    isProbing,
    probeError,
    clearProbeError,
    testResult,
    clearTestResult,
    bucketResult,
    clearBucketResult,
    test,
    createBucket,
    refresh: fetchConfig,
  };
}
