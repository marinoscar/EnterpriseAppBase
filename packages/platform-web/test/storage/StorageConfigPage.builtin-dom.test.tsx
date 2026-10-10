/**
 * The built-in drivers' markup did not move (PP-14.7, issue #925).
 *
 * The S3, R2 and S3-compatible forms moved out of `StorageConfigPage` into
 * `S3FamilyDriverPanel`, registered through `registerStorageDriverPanel`. The
 * snapshot beside this file (`__snapshots__/`) was RECORDED FROM THE PAGE AS IT
 * WAS BEFORE THAT CHANGE (the same fixtures, rendered by the old
 * `StorageConfigPage`), so passing means the form an administrator sees for each
 * built-in is, element for element and class for class, the one they had.
 *
 * Normalised on purpose: the radio label and the path-style sentence name the
 * S3-compatible driver. They came from a hard-coded label table ("S3-compatible
 * (MinIO, Wasabi, Backblaze B2…)") and now come from the driver's own label
 * ("S3-compatible", what the API serves); the table's text is folded to the
 * driver's before comparing. Re-record the snapshot only for a deliberate change
 * of the built-in forms.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/storage/headless/use-storage-config.js', () => ({ useStorageConfig: vi.fn() }));

import { useStorageConfig } from '../../src/storage/headless/use-storage-config.js';
import type { StorageConfigView } from '../../src/storage/headless/index.js';
import StorageConfigPage from '../../src/storage/ui/StorageConfigPage.js';
import { render } from './harness.js';
import { builtinDrivers, storageConfigFixture } from './fixtures.js';

const mockUseStorageConfig = vi.mocked(useStorageConfig);

function mount(config: StorageConfigView): string {
  mockUseStorageConfig.mockReturnValue({
    config,
    isLoading: false,
    loadError: null,
    isSaving: false,
    saveError: null,
    switchRequired: null,
    clearSwitchRequired: vi.fn(),
    save: vi.fn(),
    clearSaveError: vi.fn(),
    isProbing: false,
    probeError: null,
    clearProbeError: vi.fn(),
    testResult: null,
    clearTestResult: vi.fn(),
    bucketResult: null,
    clearBucketResult: vi.fn(),
    test: vi.fn(),
    createBucket: vi.fn(),
    refresh: vi.fn(),
  });
  const { container, unmount } = render(<StorageConfigPage />);
  const html = container.innerHTML.replaceAll('S3-compatible (MinIO, Wasabi, Backblaze B2…)', 'S3-compatible');
  unmount();
  return html;
}

describe('the built-in drivers\' forms are unchanged', () => {
  beforeEach(() => vi.clearAllMocks());

  it('s3', () => {
    expect(mount(storageConfigFixture())).toMatchSnapshot();
  });

  it('r2, with an account id and a stored endpoint override', () => {
    expect(
      mount(
        storageConfigFixture({
          provider: 'r2',
          drivers: builtinDrivers({
            r2: { bucket: 'objects', accountId: 'acct123', region: '', endpoint: 'https://old.example.com', accessKeyId: 'AKIAR2', forcePathStyle: true },
          }),
          bucket: 'objects',
          region: '',
          accountId: 'acct123',
          endpoint: 'https://old.example.com',
          accessKeyId: 'AKIAR2',
          forcePathStyle: true,
        }),
      ),
    ).toMatchSnapshot();
  });

  it('s3compatible, not yet configured and with no stored secret', () => {
    expect(
      mount(
        storageConfigFixture({
          provider: 's3compatible',
          drivers: builtinDrivers({
            s3compatible: { bucket: '', region: '', endpoint: '', accessKeyId: '', forcePathStyle: false },
          }),
          bucket: '',
          region: '',
          accessKeyId: '',
          forcePathStyle: false,
          configured: false,
          missing: ['bucket', 'endpoint', 'secretAccessKey'],
          secretStatus: { configured: false, hint: null, updatedAt: null, updatedByUserId: null },
        }),
      ),
    ).toMatchSnapshot();
  });
});
