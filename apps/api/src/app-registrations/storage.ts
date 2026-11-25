import { registerStorageDriver } from '@marinoscar/platform-api/storage';

import { localFsStorageDriver } from '../platform-extensions/storage/local-fs.driver';

// =============================================================================
// This app's storage drivers (PP-14.7, issue #925)
// =============================================================================
//
// A storage driver is added HERE, with `registerStorageDriver`, AT IMPORT TIME:
// the registry freezes once the application has bootstrapped, and
// `platform/storage/storage.config.ts` imports this file before it builds the
// storage module. Like `ai.ts`, `host.ts` and `core.ts`, this file makes the
// `register` call itself.
//
// Registering is all it takes. The driver then has a `drivers.<id>` record in
// the `storage` settings namespace validated by its own schema, a generated
// form on /admin/settings/storage (settings and write-only secrets, "Test
// connection", "Create bucket" when it provisions), a credential purpose for
// its secrets (`storage_<id>`), and, once an administrator selects it, every
// consumer of the storage provider (the objects API, profile images, exports,
// database backups, the node object store) writes through it. Recipe:
// docs/EXTENDING.md and the package README of `@marinoscar/platform-api/storage`.
//
// The reference app registers the worked example, `local-fs`: objects as files
// in a folder on the API host, no cloud account and no secret. It is registered
// so the example is the real thing, but OFF until an administrator selects it
// and saves: a fresh install keeps `s3` as the active driver and gains a
// "Local filesystem" entry in the driver list, nothing else. A fork that does
// not want it deletes the `registerStorageDriver` call below (and the
// `platform-extensions/storage/local-fs.driver.ts` file).
// =============================================================================

registerStorageDriver(localFsStorageDriver);
