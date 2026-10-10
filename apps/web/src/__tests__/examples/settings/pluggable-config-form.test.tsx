/**
 * Issue #923 (PP-14.5): `PluggableConfigForm` and `usePluggableConfigForm` in
 * the reference app, rendering the descriptors of the `greeter` example kind
 * (apps/api/src/platform-extensions/core/greeter.kind.ts) with no API call.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { renderWithProviders } from '../../utils/test-utils';
import { GreeterSettingsForm, PLAIN_DESCRIPTOR, SIGNED_DESCRIPTOR } from './GreeterSettings.example';

describe('PluggableConfigForm example: the greeter kind (#923)', () => {
  it('renders the plain greeter and saves only what changed in the settings', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderWithProviders(
      <GreeterSettingsForm
        descriptor={PLAIN_DESCRIPTOR}
        stored={{ greeting: 'Hello', shout: false, repeat: 1 }}
        canWrite
        onSave={onSave}
      />,
    );

    expect(screen.getByRole('group', { name: 'Plain greeter' })).toBeInTheDocument();
    expect(screen.getByLabelText('Greeting')).toHaveValue('Hello');
    expect(screen.getByText('How many times to say it')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.click(screen.getByRole('switch', { name: 'Shout' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith('plain', {
      settings: { greeting: 'Hello', shout: true, repeat: 1 },
      secrets: {},
    });
  });

  it('keeps the signed greeter secret write-only and out of the payload until typed', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderWithProviders(
      <GreeterSettingsForm
        descriptor={SIGNED_DESCRIPTOR(true)}
        stored={{ greeting: 'Greetings', style: 'formal' }}
        canWrite
        onSave={onSave}
      />,
    );

    const key = screen.getByLabelText(/Signing key/);
    expect(key).toHaveValue('');
    expect(key).toHaveAttribute('type', 'password');
    expect(screen.getByText(/A signing key is saved/)).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Style' }));
    await user.click(screen.getByRole('option', { name: 'casual' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenLastCalledWith('signed', {
      settings: { greeting: 'Greetings', style: 'casual' },
      secrets: {},
    });

    await user.type(screen.getByLabelText(/Signing key/), 'sk-new');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenLastCalledWith('signed', {
      settings: { greeting: 'Greetings', style: 'casual' },
      secrets: { apiKey: 'sk-new' },
    });
  });

  it('asks for a required secret that is not set yet and clears typed text on Reset', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <GreeterSettingsForm descriptor={SIGNED_DESCRIPTOR(false)} stored={{ greeting: 'Greetings' }} canWrite onSave={vi.fn()} />,
    );
    const key = screen.getByLabelText(/Signing key/);
    expect(key).toBeRequired();
    expect(screen.getByText('Stored encrypted; never shown again after saving.')).toBeInTheDocument();

    await user.type(key, 'typed');
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText(/Signing key/)).toHaveValue('');
  });

  it('disables the controls without the write permission', () => {
    renderWithProviders(
      <GreeterSettingsForm descriptor={SIGNED_DESCRIPTOR(true)} stored={{ greeting: 'Greetings' }} canWrite={false} onSave={vi.fn()} />,
    );
    expect(screen.getByLabelText('Greeting')).toBeDisabled();
    expect(screen.getByLabelText(/Signing key/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
