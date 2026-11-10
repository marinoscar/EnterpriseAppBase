// The core time zone row of the profile card: it is drawn under the display
// name, kept in the card's draft and saved with the card's Save button.

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { render, mockUser } from './test-utils.js';
import { ProfileSettings } from '../../../src/settings/ui/ProfileSettings.js';

vi.mock('../../../src/settings/headless/profile-image.js', () => ({
  useProfileImageClient: () => ({ upload: vi.fn(), remove: vi.fn(), preview: vi.fn() }),
}));

const noPicture = { wrapperOptions: { user: { ...mockUser, providerProfileImageUrl: null } } };

async function pick(search: string, option: RegExp) {
  await userEvent.click(screen.getByRole('button', { name: 'Change time zone' }));
  const dialog = await screen.findByRole('dialog', { name: 'Select your time zone' });
  await userEvent.type(within(dialog).getByRole('combobox', { name: 'Search time zones' }), search);
  await userEvent.click(await screen.findByRole('option', { name: option }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

describe('ProfileSettings time zone', () => {
  it('saves a chosen zone with the display name', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProfileSettings profile={{ displayName: 'Ada', imageSource: 'none', imageObjectId: null }} onSave={onSave} />, noPicture);
    expect(screen.getByTestId('time-zone-readout')).toHaveTextContent(/^Automatic/);
    const save = screen.getByRole('button', { name: 'Save Changes' });
    expect(save).toBeDisabled();

    await pick('Tokyo', /Tokyo/);
    expect(screen.getByTestId('time-zone-readout')).toHaveTextContent(/^Asia\/Tokyo/);
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(onSave).toHaveBeenCalledWith({ displayName: 'Ada', timezone: 'Asia/Tokyo' });
  });

  it('sends null when the user goes back to Automatic', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ProfileSettings profile={{ displayName: 'Ada', imageSource: 'none', imageObjectId: null, timezone: 'Europe/Paris' }} onSave={onSave} />,
      noPicture,
    );
    expect(screen.getByTestId('time-zone-readout')).toHaveTextContent(/^Europe\/Paris/);
    await userEvent.click(screen.getByRole('button', { name: 'Change time zone' }));
    const dialog = await screen.findByRole('dialog', { name: 'Select your time zone' });
    await userEvent.click(within(dialog).getByRole('switch', { name: /Automatic/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(onSave).toHaveBeenCalledWith({ displayName: 'Ada', timezone: null });
  });

  it('sends no timezone when it did not change, and never hands it to ExtraFields', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const seen: Record<string, unknown>[] = [];
    render(
      <ProfileSettings
        profile={{ displayName: 'Ada', imageSource: 'none', imageObjectId: null, timezone: 'Europe/Paris' }}
        onSave={onSave}
        slots={{
          ExtraFields: ({ values }) => {
            seen.push({ ...values });
            return null;
          },
        }}
      />,
      noPicture,
    );
    expect(seen.at(-1)).toEqual({});
    await userEvent.type(screen.getByLabelText('Display Name'), 'n');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(onSave).toHaveBeenCalledWith({ displayName: 'Adan' });
  });
});
