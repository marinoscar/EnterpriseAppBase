import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readAndroidIdentity } from './identity.js';

// =============================================================================
// Gradle invocation for apps/android  (issue #286, epic #276)
// =============================================================================

/**
 * The app's applicationId when the build cannot be read: the identity's
 * (`com.<repo>.android` unless identity.json's `android` block overrides it),
 * the rule the Android build derives too.
 *
 * @param repoRoot - the repository root, when known.
 * @returns the application id.
 */
export function defaultPackageName(repoRoot?: string): string {
  return readAndroidIdentity(repoRoot).applicationId;
}

export function gradlewPath(projectDir: string, platform: NodeJS.Platform = process.platform): string {
  return join(projectDir, platform === 'win32' ? 'gradlew.bat' : 'gradlew');
}

/**
 * A literal `applicationId = "…"` from app/build.gradle.kts, else the identity's
 * (the platform's Gradle build derives it from identity.json, so the file
 * usually holds no literal).
 */
export function readApplicationId(projectDir: string): string {
  const repoRoot = join(projectDir, '..', '..');
  const file = join(projectDir, 'app', 'build.gradle.kts');
  if (!existsSync(file)) return defaultPackageName(repoRoot);
  const match = /applicationId\s*=\s*"([^"]+)"/.exec(readFileSync(file, 'utf8'));
  return match?.[1] ?? defaultPackageName(repoRoot);
}

export interface GradleArgsInput {
  debug: boolean;
  versionName: string;
  versionCode: number;
  serverUrl?: string | undefined;
  extra?: readonly string[] | undefined;
}

/**
 * Arguments for `gradlew`. The version is passed as `-Papp.*` explicitly
 * so the build carries version.properties' values even on a checkout whose
 * Gradle script does not read the file yet.
 */
export function gradleArgs(input: GradleArgsInput): string[] {
  return [
    input.debug ? 'assembleDebug' : 'assembleRelease',
    `-Papp.versionName=${input.versionName}`,
    `-Papp.versionCode=${input.versionCode}`,
    ...(input.serverUrl !== undefined ? [`-Papp.serverUrl=${input.serverUrl}`] : []),
    '--console=plain',
    ...(input.extra ?? []),
  ];
}

/** Where AGP writes the APK. */
export function builtApkPath(projectDir: string, debug: boolean): string {
  return debug
    ? join(projectDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
    : join(projectDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
}
