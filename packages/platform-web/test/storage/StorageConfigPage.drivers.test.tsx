/**
 * `/admin/settings/storage` — pluggable drivers (PP-14.7, issue #925).
 *
 * The radios are the drivers the API describes; the three built-ins draw their
 * registered S3-family panel, every other driver is generated from its
 * descriptor; the page saves `{ provider, drivers: { id: settings }, secrets }`.
 * `useStorageConfig` is mocked, as in the reference app's page test: this
 * suite is about what the page decides, not the hook's plumbing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

vi.mock('../../src/storage/headless/use-storage-config.js', () => ({ useStorageConfig: vi.fn() }));

import { useStorageConfig } from '../../src/storage/headless/use-storage-config.js';
import type { StorageConfigView, StorageConnectionTestResult } from '../../src/storage/headless/index.js';
import StorageConfigPage from '../../src/storage/ui/StorageConfigPage.js';
import {
  registerStorageDriverPanel,
  resetStorageDriverPanelsForTests,
} from '../../src/storage/ui/storageDriverPanelRegistry.js';
import type { StorageDriverPanelProps } from '../../src/storage/ui/storageDriverPanelRegistry.js';
import { READ_ONLY_PERMISSIONS, render } from './harness.js';
import { builtinDrivers, storageConfigFixture, storageConfigWithCustomDrivers, vaultBlobDescriptor } from './fixtures.js';

const mockUseStorageConfig = vi.mocked(useStorageConfig);
const TYPED_SECRET = 'AccountKey=TYPED-SECRET-NEVER-RENDERED-77aa';

function setHook(config: StorageConfigView, overrides: Partial<ReturnType<typeof useStorageConfig>> = {}) {
  const save = vi.fn().mockResolvedValue(true);
  const test = vi.fn().mockResolvedValue(undefined);
  const createBucket = vi.fn().mockResolvedValue(undefined);
  mockUseStorageConfig.mockReturnValue({
    config,
    isLoading: false,
    loadError: null,
    isSaving: false,
    saveError: null,
    switchRequired: null,
    clearSwitchRequired: vi.fn(),
    save,
    clearSaveError: vi.fn(),
    isProbing: false,
    probeError: null,
    clearProbeError: vi.fn(),
    testResult: null,
    clearTestResult: vi.fn(),
    bucketResult: null,
    clearBucketResult: vi.fn(),
    test,
    createBucket,
    refresh: vi.fn(),
    ...overrides,
  });
  return { save, test, createBucket };
}

const saveButton = () => screen.getByRole('button', { name: /save changes/i });
const radio = (name: RegExp | string) => screen.getByRole('radio', { name });

function localFsResult(overrides: Partial<StorageConnectionTestResult> = {}): StorageConnectionTestResult {
  return {
    success: true,
    provider: 'local-fs',
    bucket: '/var/lib/objects',
    region: '',
    effectiveEndpoint: null,
    usedStoredSecret: false,
    checks: [],
    message: 'Wrote, read back and deleted a probe file.',
    details: { directory: '/var/lib/objects', writable: true },
    attemptedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('StorageConfigPage — drivers from descriptors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    resetStorageDriverPanelsForTests();
  });

  it('lists one radio per described driver, labelled by the driver, the active one checked', () => {
    setHook(storageConfigWithCustomDrivers());
    render(<StorageConfigPage />);

    const labels = screen.getAllByRole('radio').map((el) => el.closest('label')?.textContent);
    // The three path-style radios are not drivers; the provider group is the first four.
    expect(labels.slice(0, 5)).toEqual(['Amazon S3', 'Cloudflare R2', 'S3-compatible', 'Local filesystem', 'Vault Blob']);
    expect(radio('Amazon S3')).toBeChecked();
    expect(radio('Local filesystem')).not.toBeChecked();
  });

  it('draws the registered S3-family panel for a built-in and no generic panel', () => {
    setHook(storageConfigWithCustomDrivers());
    render(<StorageConfigPage />);

    expect(screen.getByLabelText(/^bucket$/i)).toHaveValue('app-objects');
    expect(screen.getByLabelText(/secret access key/i)).toHaveAttribute('type', 'password');
    expect(screen.getByRole('radio', { name: /force path-style off/i })).toBeInTheDocument();
    expect(screen.queryByTestId('storage-driver-panel-s3')).not.toBeInTheDocument();
  });

  it('draws a generic panel for a driver without a registered panel', async () => {
    setHook(storageConfigWithCustomDrivers());
    render(<StorageConfigPage />);

    await userEvent.setup().click(radio('Local filesystem'));

    expect(screen.getByTestId('storage-driver-panel-local-fs')).toBeInTheDocument();
    expect(screen.getByLabelText('Directory')).toHaveValue('');
    // The S3 panel is gone, not hidden.
    expect(screen.queryByLabelText(/^bucket$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/secret access key/i)).not.toBeInTheDocument();
  });

  it('saves only the provider and that driver\'s settings, nothing flat, no secrets', async () => {
    const user = userEvent.setup();
    const { save } = setHook(storageConfigWithCustomDrivers());
    render(<StorageConfigPage />);

    await user.click(radio('Local filesystem'));
    await user.type(screen.getByLabelText('Directory'), '/var/lib/objects');
    await user.click(saveButton());

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0]).toEqual({
      provider: 'local-fs',
      drivers: { 'local-fs': { directory: '/var/lib/objects' } },
    });
  });

  it('enables Save for a switch of driver alone, and not before', async () => {
    const user = userEvent.setup();
    setHook(storageConfigWithCustomDrivers());
    render(<StorageConfigPage />);
    expect(saveButton()).toBeDisabled();

    await user.click(radio('Local filesystem'));
    expect(saveButton()).toBeEnabled();

    await user.click(radio('Amazon S3'));
    expect(saveButton()).toBeDisabled();
  });

  it('sends a cleared text field as an empty string, so the merge on the API replaces the stored value', async () => {
    const user = userEvent.setup();
    const config = storageConfigWithCustomDrivers({
      provider: 'local-fs',
      drivers: builtinDrivers({ 'local-fs': { directory: '/old/path' }, 'vault-blob': { container: 'objects', tier: 'hot' } }),
    });
    const { save } = setHook(config);
    render(<StorageConfigPage />);

    await user.clear(screen.getByLabelText('Directory'));
    await user.click(saveButton());

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0]).toEqual({ provider: 'local-fs', drivers: { 'local-fs': { directory: '' } } });
  });

  it('keeps a driver\'s edits when the admin switches away and back', async () => {
    const user = userEvent.setup();
    setHook(storageConfigWithCustomDrivers());
    render(<StorageConfigPage />);

    await user.click(radio('Local filesystem'));
    await user.type(screen.getByLabelText('Directory'), '/keep/me');
    await user.click(radio('Amazon S3'));
    await user.click(radio('Local filesystem'));

    expect(screen.getByLabelText('Directory')).toHaveValue('/keep/me');
  });

  it('sends a typed secret under secrets.<id>.<name> only, and never renders it', async () => {
    const user = userEvent.setup();
    const { save } = setHook(storageConfigWithCustomDrivers());
    const { container } = render(<StorageConfigPage />);

    await user.click(radio('Vault Blob'));
    const secret = screen.getByLabelText(/Connection string/);
    expect(secret).toHaveAttribute('type', 'password');
    await user.type(secret, TYPED_SECRET);

    expect(container.textContent).not.toContain(TYPED_SECRET);
    expect(save).not.toHaveBeenCalled();

    await user.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalled());
    const body = save.mock.calls[0]![0];
    expect(body.secrets).toEqual({ 'vault-blob': { connectionString: TYPED_SECRET } });
    expect(JSON.stringify(body.drivers)).not.toContain(TYPED_SECRET);
    expect(body).not.toHaveProperty('secretAccessKey');
  });

  it('omits secrets entirely when none was typed (blank keeps the stored one)', async () => {
    const user = userEvent.setup();
    const config = storageConfigWithCustomDrivers({
      descriptors: [...storageConfigWithCustomDrivers().descriptors.slice(0, 4), vaultBlobDescriptor(true)],
    });
    const { save } = setHook(config);
    render(<StorageConfigPage />);

    await user.click(radio('Vault Blob'));
    await user.type(screen.getByLabelText('Container'), '-2');
    await user.click(saveButton());

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0]).not.toHaveProperty('secrets');
    expect(screen.getByLabelText(/Connection string/)).not.toBeRequired();
  });

  it('tests and provisions with the same body as a save, on the unsaved form', async () => {
    const user = userEvent.setup();
    const { test, createBucket } = setHook(storageConfigWithCustomDrivers(), {
      testResult: localFsResult({ success: false, message: 'The folder does not exist.' }),
    });
    render(<StorageConfigPage />);

    await user.click(radio('Local filesystem'));
    await user.type(screen.getByLabelText('Directory'), '/nope');
    await user.click(screen.getByRole('button', { name: /test connection/i }));
    await user.click(screen.getByTestId('storage-create-bucket'));

    const expected = { provider: 'local-fs', drivers: { 'local-fs': { directory: '/nope' } } };
    await waitFor(() => expect(test).toHaveBeenCalledWith(expected));
    expect(createBucket).toHaveBeenCalledWith(expected);
  });
});

describe('StorageConfigPage — a driver\'s own test and provisioning answers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the message and details of a test, and no stored-secret sentence for a driver without secrets', () => {
    setHook(storageConfigWithCustomDrivers({ provider: 'local-fs' }), { testResult: localFsResult() });
    render(<StorageConfigPage />);

    const result = screen.getByTestId('storage-test-result');
    expect(within(result).getByTestId('storage-test-message')).toHaveTextContent('Wrote, read back and deleted a probe file.');
    const details = within(result).getByTestId('storage-test-details');
    expect(details).toHaveTextContent('directory');
    expect(details).toHaveTextContent('/var/lib/objects');
    expect(details).toHaveTextContent('writable');
    expect(details).toHaveTextContent('true');
    expect(result).toHaveTextContent('no secret needed');
    expect(result).not.toHaveTextContent('tested with the');
    expect(screen.queryByTestId('storage-check-credentials')).not.toBeInTheDocument();
  });

  it('keeps the stored-secret sentence for a driver that declares a secret', () => {
    setHook(storageConfigWithCustomDrivers({ provider: 'vault-blob' }), {
      testResult: localFsResult({ provider: 'vault-blob', usedStoredSecret: true }),
    });
    render(<StorageConfigPage />);

    expect(screen.getByTestId('storage-test-result')).toHaveTextContent('tested with the stored secret key');
  });

  it('does not offer the provisioning action before a test, or after a passing one', () => {
    setHook(storageConfigWithCustomDrivers({ provider: 'local-fs' }));
    const { unmount } = render(<StorageConfigPage />);
    expect(screen.queryByTestId('storage-create-bucket')).not.toBeInTheDocument();
    unmount();

    setHook(storageConfigWithCustomDrivers({ provider: 'local-fs' }), { testResult: localFsResult() });
    render(<StorageConfigPage />);
    expect(screen.queryByTestId('storage-create-bucket')).not.toBeInTheDocument();
  });

  it('offers it after a failed test that reported no checks, and shows the driver\'s answer, skipped steps included', () => {
    setHook(storageConfigWithCustomDrivers({ provider: 'local-fs' }), {
      testResult: localFsResult({ success: false, message: 'The folder does not exist.' }),
      bucketResult: {
        outcome: 'failed',
        provider: 'local-fs',
        bucket: '/var/lib/objects',
        region: '',
        effectiveEndpoint: null,
        steps: [{ id: 'create', label: 'Create', status: 'skipped', detail: 'Not supported.', error: null }],
        message: 'The local-fs driver cannot create this folder.',
        guidance: null,
        corsOrigin: null,
        attemptedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    render(<StorageConfigPage />);

    expect(screen.getByTestId('storage-create-bucket')).toBeInTheDocument();
    expect(screen.getByTestId('storage-bucket-message')).toHaveTextContent('The local-fs driver cannot create this folder.');
    expect(screen.getByTestId('storage-bucket-step-create')).toHaveTextContent('Not supported.');
    expect(screen.getByTestId('storage-bucket-result').className).toMatch(/MuiAlert-colorError/);
  });

  it('lists a custom driver\'s missing settings in the not-configured notice', () => {
    setHook(storageConfigWithCustomDrivers({ provider: 'vault-blob', configured: false, missing: ['container', 'connectionString'] }));
    render(<StorageConfigPage />);

    expect(screen.getByTestId('storage-not-configured')).toHaveTextContent('container, connectionString');
  });
});

describe('StorageConfigPage — an app\'s own panel and the edge cases', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => resetStorageDriverPanelsForTests());

  it('draws an app-registered panel instead of the generated one, handing it the page state', async () => {
    const user = userEvent.setup();
    const seen: StorageDriverPanelProps[] = [];
    registerStorageDriverPanel('local-fs', (panelProps) => {
      seen.push(panelProps);
      return (
        <button type="button" onClick={() => panelProps.onChange('directory', '/from-panel')}>
          Pick folder
        </button>
      );
    });
    const { save } = setHook(storageConfigWithCustomDrivers());
    render(<StorageConfigPage />);

    await user.click(radio('Local filesystem'));
    expect(screen.queryByTestId('storage-driver-panel-local-fs')).not.toBeInTheDocument();
    expect(seen.at(-1)).toMatchObject({
      provider: 'local-fs',
      value: { directory: '' },
      canWrite: true,
      errors: {},
    });
    expect(seen.at(-1)?.descriptor.label).toBe('Local filesystem');
    expect(seen.at(-1)?.config.provider).toBe('s3');

    await user.click(screen.getByRole('button', { name: 'Pick folder' }));
    await user.click(saveButton());

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0].drivers).toEqual({ 'local-fs': { directory: '/from-panel' } });
  });

  it('blocks Save, Test and the provisioning action while the registered validator reports errors', async () => {
    const user = userEvent.setup();
    registerStorageDriverPanel(
      'local-fs',
      ({ value, onChange, errors }) => (
        <>
          <input aria-label="Folder" value={String(value.directory ?? '')} onChange={(e) => onChange('directory', e.target.value)} />
          {errors.directory && <p role="alert">{errors.directory}</p>}
        </>
      ),
      {
        validate: (value): Record<string, string> =>
          String(value.directory ?? '').startsWith('/') || !value.directory ? {} : { directory: 'Must be absolute.' },
      },
    );
    setHook(storageConfigWithCustomDrivers());
    render(<StorageConfigPage />);

    await user.click(radio('Local filesystem'));
    await user.type(screen.getByLabelText('Folder'), 'relative');

    expect(screen.getByRole('alert')).toHaveTextContent('Must be absolute.');
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
    expect(screen.getByText('Fix the highlighted fields first.')).toBeInTheDocument();
  });

  it('warns when the active driver is not registered in this build, instead of drawing a form', () => {
    setHook(storageConfigFixture({ provider: 'gone-driver' }));
    render(<StorageConfigPage />);

    expect(screen.getByTestId('storage-driver-unavailable')).toHaveTextContent('gone-driver');
    expect(screen.queryByLabelText(/^bucket$/i)).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('disables the radios and the generic panel for a read-only viewer, without hiding them', async () => {
    setHook(storageConfigWithCustomDrivers({ provider: 'local-fs', drivers: builtinDrivers({ 'local-fs': { directory: '/d' } }) }));
    render(<StorageConfigPage />, READ_ONLY_PERMISSIONS);

    expect(radio('Local filesystem')).toBeDisabled();
    expect(screen.getByLabelText('Directory')).toBeDisabled();
    expect(saveButton()).toBeDisabled();
  });
});
