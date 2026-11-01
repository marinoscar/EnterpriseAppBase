/**
 * `npm run storage:purge`: what `appctl deploy uninstall --purge-storage` runs
 * INSIDE the api image (issue #404; packaged in #736).
 *
 * A thin entry point: it boots the application context and hands it to
 * `runStoragePurgeCli` of `@marinoscar/platform-api/storage`, which reads the
 * LIVE storage configuration through the app's own `StorageConfigService` and
 * enumerates `allKeyPrefixes()` of the BOOTED app, so every prefix the app
 * registered (platform and app alike) is included. Flags, JSON output and exit
 * codes are unchanged: a dry run by default (`--json`), `--confirm --bucket
 * <typed>` to delete after the typed name is re-checked against the live
 * configuration here, inside the container. Why this runs in the image and
 * not in the CLI, and why an unreadable versioning status counts as
 * versioned: `packages/platform-api/src/storage/purge/run-storage-purge.ts`.
 */
import { NestFactory } from '@nestjs/core';
import { runStoragePurgeCli } from '@marinoscar/platform-api/storage';

import { AppModule } from './app.module';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    process.exitCode = await runStoragePurgeCli(app, process.argv);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
