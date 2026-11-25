/** `ProfileSettings` upload mode when storage is not configured. */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render, mockUser } from './test-utils.js';
import { ProfileSettings } from '../../../src/settings/ui/ProfileSettings.js';
import { createTestApiError, createTestPlatformHost } from '../../../src/testing/index.js';
import type { UserSettingsResponseBase } from '@marinoscar/platform-contract/settings';

type UserSettings = UserSettingsResponseBase;

const upload: UserSettings['profile'] = { displayName: undefined, imageSource: 'upload', imageObjectId: null };

function storage(configured: boolean | 'error') {
  return createTestPlatformHost({
    permissions: mockUser.permissions,
    userId: mockUser.id,
    responses: {
      'GET /storage/status': () => {
        if (configured === 'error') throw createTestApiError(500, 'boom');
        return { configured };
      },
    },
  });
}

describe('ProfileSettings: storage not configured', () => {
  it('upload mode with storage false shows the notice and no upload control', async () => {
    const host = storage(false);
    render(<ProfileSettings profile={upload} onSave={async () => {}} />, { wrapperOptions: { user: mockUser, host } });
    expect(await screen.findByText("Storage isn't enabled yet")).toBeInTheDocument();
    expect(screen.getByText(/You can still use the picture from your sign-in provider, or none\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload picture/i })).not.toBeInTheDocument();
  });

  it('an unknown answer keeps the upload control', async () => {
    const host = storage('error');
    render(<ProfileSettings profile={upload} onSave={async () => {}} />, { wrapperOptions: { user: mockUser, host } });
    await waitFor(() => expect(screen.getByRole('button', { name: /upload picture/i })).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("Storage isn't enabled yet")).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload picture/i })).toBeInTheDocument();
  });

  it('storage configured keeps the upload control', async () => {
    const host = storage(true);
    render(<ProfileSettings profile={upload} onSave={async () => {}} />, { wrapperOptions: { user: mockUser, host } });
    expect(await screen.findByRole('button', { name: /upload picture/i })).toBeInTheDocument();
    expect(screen.queryByText("Storage isn't enabled yet")).not.toBeInTheDocument();
  });
});
