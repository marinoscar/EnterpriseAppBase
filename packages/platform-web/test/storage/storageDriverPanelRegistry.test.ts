/**
 * The storage driver panel registry (PP-14.7, issue #925).
 *
 * The three built-in drivers register their bespoke panel through the same
 * function an app uses; an app's registration wins over a built-in's in either
 * load order; resetting forgets the app's and keeps the built-ins.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { S3FamilyDriverPanel } from '../../src/storage/ui/S3FamilyDriverPanel.js';
import { StorageGenericDriverPanel } from '../../src/storage/ui/StorageGenericDriverPanel.js';
import {
  BUILTIN_STORAGE_DRIVER_PANEL_IDS,
  registerBuiltinStorageDriverPanels,
} from '../../src/storage/ui/builtinStorageDriverPanels.js';
import {
  getStorageDriverPanel,
  getStorageDriverPanelValidator,
  registerBuiltinStorageDriverPanel,
  registerStorageDriverPanel,
  resetStorageDriverPanelsForTests,
} from '../../src/storage/ui/storageDriverPanelRegistry.js';
import * as driverPanels from '../../src/storage/ui/driver-panels.js';
import * as storageUi from '../../src/storage/ui/index.js';

const AppPanel = () => null;
const OtherPanel = () => null;

describe('the storage driver panel registry', () => {
  beforeAll(() => registerBuiltinStorageDriverPanels());
  afterEach(() => resetStorageDriverPanelsForTests());

  it('has the S3 family panel for s3, r2 and s3compatible, and nothing for another driver', () => {
    expect([...BUILTIN_STORAGE_DRIVER_PANEL_IDS]).toEqual(['s3', 'r2', 's3compatible']);
    for (const id of BUILTIN_STORAGE_DRIVER_PANEL_IDS) expect(getStorageDriverPanel(id)).toBe(S3FamilyDriverPanel);
    expect(getStorageDriverPanel('local-fs')).toBeUndefined();
  });

  it('registers a panel by driver id', () => {
    registerStorageDriverPanel('local-fs', AppPanel);

    expect(getStorageDriverPanel('local-fs')).toBe(AppPanel);
  });

  it('replaces an earlier registration of the same id (a hot reload re-runs the module)', () => {
    registerStorageDriverPanel('local-fs', AppPanel);
    registerStorageDriverPanel('local-fs', OtherPanel);

    expect(getStorageDriverPanel('local-fs')).toBe(OtherPanel);
  });

  it('lets an app replace a built-in panel, whichever module loaded first', () => {
    registerStorageDriverPanel('s3', AppPanel);
    // The built-ins register again afterwards (the page module loads late).
    registerBuiltinStorageDriverPanels();

    expect(getStorageDriverPanel('s3')).toBe(AppPanel);
    expect(getStorageDriverPanel('r2')).toBe(S3FamilyDriverPanel);
  });

  it('forgets app registrations on reset but keeps the built-ins', () => {
    registerStorageDriverPanel('s3', AppPanel);
    registerStorageDriverPanel('local-fs', AppPanel);

    resetStorageDriverPanelsForTests();

    expect(getStorageDriverPanel('s3')).toBe(S3FamilyDriverPanel);
    expect(getStorageDriverPanel('local-fs')).toBeUndefined();
  });

  it('hands the page the validator registered with the panel', () => {
    registerStorageDriverPanel('local-fs', AppPanel, {
      validate: (value) => (value.directory === 'bad' ? { directory: 'No.' } : {}),
    });

    expect(getStorageDriverPanelValidator('local-fs')?.({ directory: 'bad' })).toEqual({ directory: 'No.' });
    expect(getStorageDriverPanelValidator('local-fs')?.({ directory: '/ok' })).toEqual({});
    expect(getStorageDriverPanelValidator('unregistered')).toBeUndefined();
  });

  it('validates the S3 family the way the page always did', () => {
    const validate = getStorageDriverPanelValidator('s3compatible')!;

    expect(validate({ bucket: 'b', endpoint: '' })).toEqual({
      endpoint: 'An S3-compatible provider needs an endpoint — there is no default host.',
    });
    expect(validate({ bucket: 'b', endpoint: 'minio' }).endpoint).toBe('Must be a full URL, e.g. https://minio.example.com:9000.');
    expect(validate({ bucket: '', endpoint: '' })).toEqual({});
    expect(getStorageDriverPanelValidator('s3')!({ bucket: 'b', region: '' }).region).toBe('Amazon S3 needs a region, e.g. us-east-1.');
    expect(getStorageDriverPanelValidator('r2')!({ bucket: 'b', accountId: '', endpoint: '' }).accountId).toBe(
      'R2 needs an account id — the endpoint is derived from it.',
    );
  });

  it('registers a panel from a replaceable built-in id without touching the app map', () => {
    registerBuiltinStorageDriverPanel('vault-blob', OtherPanel);

    expect(getStorageDriverPanel('vault-blob')).toBe(OtherPanel);
    registerStorageDriverPanel('vault-blob', AppPanel);
    expect(getStorageDriverPanel('vault-blob')).toBe(AppPanel);
  });

  it('exports the registry from the storage/ui entry and from the narrow driver-panels entry', () => {
    for (const entry of [driverPanels, storageUi]) {
      expect(entry.registerStorageDriverPanel).toBe(registerStorageDriverPanel);
      expect(entry.getStorageDriverPanel).toBe(getStorageDriverPanel);
      expect(entry.StorageGenericDriverPanel).toBe(StorageGenericDriverPanel);
    }
  });
});
