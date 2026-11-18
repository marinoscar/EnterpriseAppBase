import { STORAGE_PROVIDER, StorageProviderRouter, type StorageProvider } from '@marinoscar/platform-api/storage';

import type { TestContext } from './test-app.helper';

/**
 * Makes `mock` the storage provider of a booted test app: the active
 * `STORAGE_PROVIDER` answers with its methods, and the per-row router
 * (`StorageProviderRouter`) hands it back for every recorded provider, as the
 * routing of a real deployment would for a configured one.
 *
 * `kind` is a getter on the real provider (it answers from the settings
 * snapshot), so it is left alone.
 *
 * @param context - the booted test app.
 * @param mock - the provider double.
 */
export function installMockStorageProvider(context: TestContext, mock: StorageProvider): void {
  const token = context.module.get(STORAGE_PROVIDER, { strict: false });
  if (token) {
    const { kind: _kind, ...methods } = mock;
    Object.assign(token, methods, { resolveCurrent: async () => mock });
  }

  const router = context.module.get(StorageProviderRouter, { strict: false });
  if (router) {
    router.forLocation = async () => mock;
    router.forObject = async () => mock;
  }
}
