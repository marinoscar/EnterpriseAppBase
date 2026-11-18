// The android-app conformance suite (#746) finds what it promises to.
import { withTemporaryEntries } from '../../src/core/index';
import { registerAndroidAppKeyPrefixes } from '../../src/android-app/index';
import { androidAppConformanceSuite, checkAndroidApp, discoverAndroidAppRoutes } from '../../src/android-app/testing/index';
import { notificationChannelRegistry, registerAndroidAppNotificationChannel, registerPlatformNotificationChannels } from '../../src/notifications/index';
import { storageKeyPrefixRegistry } from '../../src/storage/index';
import { conformanceSuites } from '../../src/testing/index';

describe('android-app conformance suite', () => {
  it('registers itself with the harness on import', () => {
    expect(conformanceSuites.has('android-app')).toBe(true);
    expect(androidAppConformanceSuite.id).toBe('android-app');
  });

  it('sees assetlinks public and read-only, the download public, admin routes on system_settings:*', () => {
    const routes = Object.fromEntries(discoverAndroidAppRoutes().map((route) => [route.id, route]));
    expect(routes['AssetLinksController#getAssetLinks']).toMatchObject({ method: 'GET', isPublic: true });
    expect(routes['AndroidReleaseController#download']).toMatchObject({ method: 'GET', isPublic: true });
    expect(routes['AndroidReleaseController#latest']).toMatchObject({ isPublic: false, authenticated: true, permissions: [] });
    expect(routes['AndroidAppController#get']!.permissions).toEqual(['system_settings:read']);
    expect(routes['AndroidAppController#replace']!.permissions).toEqual(['system_settings:write']);
    expect(routes['AndroidAppController#testNotification']!.permissions).toEqual(['system_settings:write']);
    expect(routes['AndroidReleaseAdminController#list']!.permissions).toEqual(['system_settings:read']);
    for (const name of ['upload', 'makeCurrent', 'remove']) {
      expect(routes[`AndroidReleaseAdminController#${name}`]!.permissions).toEqual(['system_settings:write']);
    }
    expect(Object.keys(routes)).toHaveLength(11);
  });

  it('passes once the app registered the prefix and the channel, and lists the index', () =>
    withTemporaryEntries(storageKeyPrefixRegistry, [], () =>
      withTemporaryEntries(notificationChannelRegistry, [], () => {
        expect(checkAndroidApp({ rawSqlIndexNames: [] }).map((finding) => finding.file)).toEqual([
          'raw-sql-indexes',
          'storage-key-prefixes',
          'notification-channels',
        ]);
        registerAndroidAppKeyPrefixes();
        registerPlatformNotificationChannels();
        registerAndroidAppNotificationChannel();
        expect(checkAndroidApp({ rawSqlIndexNames: ['android_app_releases_one_current_uniq_idx'] })).toEqual([]);
      }),
    ));
});
