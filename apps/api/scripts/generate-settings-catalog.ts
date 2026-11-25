// =============================================================================
// Generate (or check) the system settings defaults catalog (issue #677)
// =============================================================================
//
// Writes `prisma/catalog/system-settings-defaults.json` from the system settings
// namespace registry (`renderSystemSettingsCatalog`), which `prisma/seed-data.ts`
// reads. Run after adding a namespace or changing a default:
//
//   npm run catalog:settings --workspace=api             # regenerate
//   npm run catalog:settings --workspace=api -- --check  # CI: exit 1 when stale
//
// Imports the registry only (no Nest, no Prisma), so it runs on a bare checkout.
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import {
  SYSTEM_SETTINGS_CATALOG_RELATIVE_PATH,
  checkSystemSettingsCatalog,
  renderSystemSettingsCatalog,
} from '../src/settings/registry/settings-catalog';

function main(): void {
  const target = resolve(__dirname, '..', SYSTEM_SETTINGS_CATALOG_RELATIVE_PATH);

  if (process.argv.includes('--check')) {
    let current: string | undefined;
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      current = undefined;
    }
    const stale = checkSystemSettingsCatalog(current);
    if (stale) {
      console.error(stale);
      process.exit(1);
    }
    console.log(`${SYSTEM_SETTINGS_CATALOG_RELATIVE_PATH} is up to date.`);
    return;
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, renderSystemSettingsCatalog());
  console.log(`Wrote ${SYSTEM_SETTINGS_CATALOG_RELATIVE_PATH}`);
}

main();
