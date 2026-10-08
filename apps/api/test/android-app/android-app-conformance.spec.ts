// The android-app slice's conformance suite, run in the reference app (#746):
// assetlinks public and read-only, the signed download the only other public
// route, admin routes on exactly system_settings:read/write, the one-current
// index on the raw-SQL list, android-releases/ surviving the factory reset,
// and the android_app channel registered, covered by push.
import { RAW_SQL_INDEXES } from '@marinoscar/platform-db';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';
import '@marinoscar/platform-api/android-app/testing';

import { API_SOURCE_ROOT } from '../jobs/cron-source-roots';
import '../../src/platform/notifications';
import '../../src/platform/storage/storage-key-prefix.manifest';
import '../../src/platform/android-app/android-app.config';

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: {
    androidApp: { rawSqlIndexNames: RAW_SQL_INDEXES.map((index) => index.name) },
  },
});
