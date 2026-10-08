import { SETTINGS_USER_OWNED_MODELS } from '@marinoscar/platform-api/settings';
import { CREDENTIALS_USER_OWNED_MODELS } from '@marinoscar/platform-api/credentials';
import { SHARING_USER_OWNED_MODELS } from '@marinoscar/platform-api/sharing';
import { ANDROID_APP_USER_OWNED_MODELS } from '@marinoscar/platform-api/android-app';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ownerFieldOf, userOwnedModelRegistry } from '@marinoscar/platform-api/core';
import { PLATFORM_USER_OWNED_MODELS } from './index';
import { APP_USER_OWNED_MODELS } from '../../app-registrations/user-owned-models';

// =============================================================================
// The app's user-owned model inventory (#688; registry moved to core by #699)
// =============================================================================
//
// The registry's own rules (validation, ids, duplicates, owner relations) are
// pinned in packages/platform-api/test/core/data-access/. The schema
// cross-check is the `userOwnedData` conformance suite, run by
// test/prisma/user-owned-models.spec.ts. This file pins what the app
// registers.
// =============================================================================

describe('the app fills userOwnedModelRegistry', () => {
  it('registers the platform inventory, then the sharing, credentials and android-app slices\', then the (empty) app list', () => {
    expect(APP_USER_OWNED_MODELS).toEqual([]);
    expect(userOwnedModelRegistry.ids()).toEqual(
      [
        ...PLATFORM_USER_OWNED_MODELS,
        ...SHARING_USER_OWNED_MODELS,
        ...SETTINGS_USER_OWNED_MODELS,
        ...CREDENTIALS_USER_OWNED_MODELS,
        ...ANDROID_APP_USER_OWNED_MODELS,
      ].map((def) => def.model),
    );
  });

  it('holds 33 models and 40 User foreign keys (the sharing slice adds 4 and 8: groups #728, grants #729; settings 1 and 1, #733; org credentials 1 and 1, #735; android-app 1 and 1, #746)', () => {
    const fields = userOwnedModelRegistry
      .list()
      .flatMap((def) => [...(def.ownerField ? [def.ownerField] : []), ...(def.actorFields ?? [])]);
    expect(userOwnedModelRegistry.size).toBe(33);
    expect(fields).toHaveLength(40);
  });

  it('gives every entry a non-empty rationale', () => {
    for (const def of userOwnedModelRegistry.list()) {
      expect(def.rationale.trim().length).toBeGreaterThan(10);
    }
  });

  it('looks up the inventory’s owner fields', () => {
    expect(ownerFieldOf('UserCredential')).toBe('userId');
    expect(ownerFieldOf('WorkerNode')).toBe('createdById');
    expect(ownerFieldOf('AuditEvent')).toBeUndefined();
    expect(ownerFieldOf('Role')).toBeUndefined();
  });

  it('keeps the inventory pure data: type-only imports, no side effect', () => {
    const source = readFileSync(join(__dirname, 'platform-user-owned-models.ts'), 'utf8');
    const imports = [...source.matchAll(/^import\s.*?from\s+'([^']+)';/gms)].map((match) => match[0]);
    expect(imports).toEqual([
      "import type { UserOwnedModelDef } from '@marinoscar/platform-api/core';",
      "import type { Prisma } from '@prisma/client';",
    ]);
  });
});
