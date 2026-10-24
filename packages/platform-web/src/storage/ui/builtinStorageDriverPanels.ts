// The three built-in drivers' bespoke panel, registered through the same
// registry an app uses (PP-14.7, issue #925). The admin storage page calls this
// at module scope; the component is the one that has always drawn them, so
// their markup is unchanged. A call, not a bare side-effect import: the package
// is `sideEffects: false`.

import { S3FamilyDriverPanel, validateS3FamilySettings } from './S3FamilyDriverPanel.js';
import { registerBuiltinStorageDriverPanel } from './storageDriverPanelRegistry.js';

/** The ids of the drivers whose bespoke panel ships with the slice. */
export const BUILTIN_STORAGE_DRIVER_PANEL_IDS = ['s3', 'r2', 's3compatible'] as const;

/** Registers the bespoke panel of each built-in driver. Idempotent. */
export function registerBuiltinStorageDriverPanels(): void {
  for (const id of BUILTIN_STORAGE_DRIVER_PANEL_IDS) {
    registerBuiltinStorageDriverPanel(id, S3FamilyDriverPanel, {
      validate: (value) => validateS3FamilySettings(id, value),
    });
  }
}
