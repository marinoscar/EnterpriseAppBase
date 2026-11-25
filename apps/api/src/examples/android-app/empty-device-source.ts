import { registerAndroidDeviceSource, type AndroidDeviceSource } from '@marinoscar/platform-api/android-app';

/**
 * The reference app's device source (#746): it has no native capability, so
 * no paired device reports anything and the Android app page's "reported
 * apps" list is empty. An app with a native module (EvoPath's Health Connect
 * sync, MemoriaHub's media sync) registers a source that groups its own
 * device table by (packageName, signingSha256), counts active devices and
 * takes their latest sighting; `devicesBehind` is optional.
 */
export const EMPTY_DEVICE_SOURCE: AndroidDeviceSource = {
  id: 'reference-shell',
  reportedApps: async () => [],
};

/** Registers {@link EMPTY_DEVICE_SOURCE} once (the manifest imports this file). */
export function registerEmptyDeviceSource(): void {
  registerAndroidDeviceSource(EMPTY_DEVICE_SOURCE);
}
