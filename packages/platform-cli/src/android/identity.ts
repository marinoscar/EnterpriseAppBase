// =============================================================================
// The Android app's identity, for the CLI (#746, PP-9.4)
// =============================================================================
//
// One source: `packages/shared/identity.json` and its optional `android` block
// (MemoriaHub's `identity.properties` fields: applicationId, deepLinkScheme,
// storagePrefix, apkStem), derived by `androidIdentity()` of
// `@marinoscar/platform-contract/android-app` exactly as the Gradle build
// (`platform-core/identity.gradle.kts`) derives it. The app passes its own
// identity to `androidCommand({ identity })`; inside a checkout the file on
// disk wins (it is what the APK will be built with).
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { androidIdentity, type AndroidIdentity, type AndroidIdentitySource } from '@marinoscar/platform-contract/android-app';

export type { AndroidIdentity, AndroidIdentitySource } from '@marinoscar/platform-contract/android-app';

/**
 * Where the product identity lives, relative to the repository root.
 *
 * @stability experimental
 */
export const IDENTITY_JSON_PATH = join('packages', 'shared', 'identity.json');

const NEUTRAL: AndroidIdentitySource = { productName: 'App', repoSlug: 'owner/app' };
let configured: AndroidIdentitySource | undefined;

/**
 * Sets the identity used outside a checkout (the app's own `identity.json`).
 *
 * @param source - the product identity, or undefined to clear it.
 *
 * @stability experimental
 */
export function configureAndroidIdentity(source: AndroidIdentitySource | undefined): void {
  configured = source;
}

/**
 * The Android identity: the checkout's `packages/shared/identity.json` when
 * `repoRoot` holds one, else the configured identity, else a neutral one.
 *
 * @param repoRoot - the repository root, when known.
 * @returns the resolved identity.
 *
 * @stability experimental
 */
export function readAndroidIdentity(repoRoot?: string): AndroidIdentity {
  if (repoRoot !== undefined) {
    const file = join(repoRoot, IDENTITY_JSON_PATH);
    if (existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<AndroidIdentitySource>;
        if (typeof raw.productName === 'string' && typeof raw.repoSlug === 'string') {
          return androidIdentity({ productName: raw.productName, repoSlug: raw.repoSlug, ...(raw.android ? { android: raw.android } : {}) });
        }
      } catch {
        // A broken identity.json: fall back; the Gradle build reports it.
      }
    }
  }
  return androidIdentity(configured ?? NEUTRAL);
}
