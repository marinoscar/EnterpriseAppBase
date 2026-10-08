// The host core's `maintenance` namespace of the system settings document
// (the persisted maintenance window), registered before
// `SettingsModule.forRoot()` composes the request bodies: src/platform/platform.ts
// imports this file first. `GET`/`PUT /api/admin/maintenance` read and write it.
import { MAINTENANCE_SYSTEM_SETTINGS } from '@marinoscar/platform-api/host';
import { registerSystemSettingsNamespaces, type SystemSettingsNamespace } from '@marinoscar/platform-api/settings';

registerSystemSettingsNamespaces([MAINTENANCE_SYSTEM_SETTINGS as SystemSettingsNamespace]);
