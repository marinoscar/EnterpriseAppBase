/**
 * The generic storage driver panel (PP-14.7, issue #925): a driver nobody
 * registered a panel for is drawn from its descriptor, with write-only secrets.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { StorageGenericDriverPanel } from '../../src/storage/ui/StorageGenericDriverPanel.js';
import type { StorageDriverPanelProps } from '../../src/storage/ui/storageDriverPanelRegistry.js';
import { localFsDescriptor, storageConfigWithCustomDrivers, vaultBlobDescriptor } from './fixtures.js';

const TYPED = 'AccountKey=THIS-IS-TYPED-AND-WRITE-ONLY-5d1c';
const STORED_HINT_NEVER_A_VALUE = 'stored-secret-value-never-sent-to-browser';

function props(overrides: Partial<StorageDriverPanelProps> = {}): StorageDriverPanelProps {
  return {
    provider: 'local-fs',
    descriptor: localFsDescriptor(),
    config: storageConfigWithCustomDrivers(),
    value: { directory: '/data/objects' },
    onChange: vi.fn(),
    secrets: {},
    onSecretChange: vi.fn(),
    errors: {},
    canWrite: true,
    ...overrides,
  };
}

describe('StorageGenericDriverPanel', () => {
  it('draws the label, the description and a control per setting from the descriptor', () => {
    render(<StorageGenericDriverPanel {...props()} />);

    expect(screen.getByRole('heading', { name: 'Local filesystem' })).toBeInTheDocument();
    expect(screen.getByText(/Objects as files in a folder on the API host/)).toBeInTheDocument();
    expect(screen.getByLabelText('Directory')).toHaveValue('/data/objects');
    expect(screen.getByText(/Absolute path of the folder/)).toBeInTheDocument();
    expect(screen.getByTestId('storage-driver-panel-local-fs')).toBeInTheDocument();
  });

  it('reports an edited setting by name', async () => {
    const onChange = vi.fn();
    render(<StorageGenericDriverPanel {...props({ value: { directory: '' }, onChange })} />);

    await userEvent.setup().type(screen.getByLabelText('Directory'), 'x');

    expect(onChange).toHaveBeenLastCalledWith('directory', 'x');
  });

  it('draws string, enum and number settings and a write-only secret field', () => {
    render(
      <StorageGenericDriverPanel
        {...props({
          provider: 'vault-blob',
          descriptor: vaultBlobDescriptor(false),
          value: { container: 'objects', tier: 'cool', timeoutSeconds: 30 },
        })}
      />,
    );

    expect(screen.getByLabelText('Container')).toHaveValue('objects');
    expect(screen.getByRole('combobox', { name: 'Tier' })).toHaveTextContent('cool');
    expect(screen.getByLabelText('Timeout (seconds)')).toHaveValue(30);
    const secret = screen.getByLabelText(/Connection string/);
    expect(secret).toHaveAttribute('type', 'password');
    expect(secret).toHaveValue('');
    // Nothing stored yet, so it is required.
    expect(secret).toBeRequired();
  });

  it('shows a stored secret as saved, never as a value, and does not require retyping it', () => {
    render(
      <StorageGenericDriverPanel
        {...props({ provider: 'vault-blob', descriptor: vaultBlobDescriptor(true), value: { container: 'objects' } })}
      />,
    );

    const secret = screen.getByLabelText(/Connection string/);
    expect(secret).toHaveValue('');
    expect(secret).not.toBeRequired();
    expect(screen.getByText(/saved/i)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(STORED_HINT_NEVER_A_VALUE);
  });

  it('reports a typed secret by name and keeps it out of the markup', async () => {
    const onSecretChange = vi.fn();
    const { container } = render(
      <StorageGenericDriverPanel
        {...props({
          provider: 'vault-blob',
          descriptor: vaultBlobDescriptor(true),
          value: {},
          secrets: { connectionString: '' },
          onSecretChange,
        })}
      />,
    );

    await userEvent.setup().type(screen.getByLabelText(/Connection string/), 'k');

    expect(onSecretChange).toHaveBeenCalledWith('connectionString', 'k');
    expect(container.textContent).not.toContain(TYPED);
  });

  it('disables every control for a viewer who cannot write', () => {
    render(
      <StorageGenericDriverPanel
        {...props({ provider: 'vault-blob', descriptor: vaultBlobDescriptor(true), value: {}, canWrite: false })}
      />,
    );

    expect(screen.getByLabelText('Container')).toBeDisabled();
    expect(screen.getByLabelText(/Connection string/)).toBeDisabled();
  });

  it('says so when the driver has nothing to configure', () => {
    render(<StorageGenericDriverPanel {...props({ descriptor: { ...localFsDescriptor(), fields: [] } })} />);

    expect(screen.getByText('This driver has nothing to configure.')).toBeInTheDocument();
  });

  it('shows the errors a registered validator found', () => {
    render(<StorageGenericDriverPanel {...props({ errors: { directory: 'Must be absolute.' } })} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Must be absolute.');
  });
});
