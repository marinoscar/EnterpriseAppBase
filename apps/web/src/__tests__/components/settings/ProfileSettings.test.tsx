import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockUser } from '../../utils/test-utils';
import { ProfileSettings } from '../../../components/settings/ProfileSettings';
import type { ProfileImageMutationResponse, UserSettings } from '../../../types';

/**
 * #367. `ProfileSettings` replaced the old "use Google profile image" switch
 * with a three-option radio group (none / provider / upload), and the upload
 * and remove actions now come back as a whole settings document adopted via
 * `onSettingsReplaced`, not a PATCH the caller assembles.
 *
 * The uploaded-picture PREVIEW URL assertions are kept minimal deliberately —
 * a known follow-up changes how that preview is loaded (same-origin avatar
 * route rather than a raw URL) — so tests here check behavior (which source
 * is selected, what gets saved/adopted) rather than the exact `src` MUI puts
 * on the uploaded-picture `<Avatar>`.
 */

// Mock the ImageUpload component: a button that, when clicked, reports a
// fixed successful upload result to the real `handleUploaded` in
// `ProfileSettings`, exactly like `UserSettingsPages.test.tsx` does for
// `onSettingsReplaced` one level up.
vi.mock('../../../components/settings/ImageUpload', () => ({
  ImageUpload: ({
    onUploaded,
    disabled,
    label,
  }: {
    onUploaded: (result: ProfileImageMutationResponse) => void | Promise<void>;
    disabled?: boolean;
    label?: string;
  }) => (
    <button
      data-testid="image-upload-mock"
      disabled={disabled}
      onClick={() =>
        onUploaded({
          settings: {
            theme: 'system',
            profile: { imageSource: 'upload', imageObjectId: 'obj-1' },
            updatedAt: '2024-06-01T00:00:00.000Z',
            version: 5,
          },
          profileImageUrl: 'https://example.com/uploaded-mock.jpg',
        })
      }
    >
      {label ?? 'Upload picture'}
    </button>
  ),
}));

// Mock the AuthContext - need to import original to get AuthContext
vi.mock('../../../contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../contexts/AuthContext')>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

// `ProfileSettings` calls `deleteProfileImage` directly (not through a prop),
// so it has to be mocked at the module level, like `ImageUpload.test.tsx`
// does for `uploadProfileImage`.
vi.mock('../../../services/api', () => ({
  deleteProfileImage: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    details?: unknown;
    constructor(message: string, status: number, code?: string, details?: unknown) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
}));

import { useAuth } from '../../../contexts/AuthContext';
import { deleteProfileImage } from '../../../services/api';

const mockUseAuth = vi.mocked(useAuth);
const mockDeleteProfileImage = vi.mocked(deleteProfileImage);

describe('ProfileSettings', () => {
  const defaultProfile: UserSettings['profile'] = {
    displayName: undefined,
    imageSource: 'provider',
    imageObjectId: null,
  };

  const noPictureProfile: UserSettings['profile'] = {
    displayName: undefined,
    imageSource: 'none',
    imageObjectId: null,
  };

  const uploadedProfile: UserSettings['profile'] = {
    displayName: undefined,
    imageSource: 'upload',
    imageObjectId: 'existing-object-id',
  };

  const userWithProviderImage = {
    ...mockUser,
    providerProfileImageUrl: 'https://example.com/provider-image.jpg',
  };

  const userWithoutProviderImage = {
    ...mockUser,
    providerProfileImageUrl: null,
  };

  const mockOnSave = vi.fn();
  const mockOnSettingsReplaced = vi.fn();
  const mockRefreshUser = vi.fn();

  function mockAuth(user = userWithProviderImage) {
    mockUseAuth.mockReturnValue({
      user,
      isLoading: false,
      isAuthenticated: true,
      providers: [],
      login: vi.fn(),
      logout: vi.fn(),
      refreshUser: mockRefreshUser,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshUser.mockResolvedValue(undefined);
    mockAuth();
    mockOnSave.mockResolvedValue(undefined);
  });

  describe('Rendering', () => {
    it('should render profile card with title', () => {
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      expect(screen.getByText('Profile')).toBeInTheDocument();
      expect(screen.getByText(/customize how you appear to others/i)).toBeInTheDocument();
    });

    it('should render display name input with current value', () => {
      const profile = { ...defaultProfile, displayName: 'Custom Name' };

      render(<ProfileSettings profile={profile} onSave={mockOnSave} />);

      expect(screen.getByLabelText(/display name/i)).toHaveValue('Custom Name');
    });

    it('should render empty display name input when not set', () => {
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      expect(screen.getByLabelText(/display name/i)).toHaveValue('');
    });

    it('should render email field as read-only', () => {
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      const emailInput = screen.getByLabelText(/email/i);
      expect(emailInput).toBeDisabled();
      expect(emailInput).toHaveValue(mockUser.email);
      expect(screen.getByText(/email cannot be changed/i)).toBeInTheDocument();
    });

    it('should render save button', () => {
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    });
  });

  describe('Picture source radio group', () => {
    it('should render all three picture source options with accessible labels', () => {
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      expect(screen.getByRole('radio', { name: /no picture/i })).toBeInTheDocument();
      expect(
        screen.getByRole('radio', { name: /picture from your sign-in provider/i }),
      ).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /upload a picture/i })).toBeInTheDocument();
    });

    it('should check the option matching the saved imageSource', () => {
      render(<ProfileSettings profile={noPictureProfile} onSave={mockOnSave} />);

      expect(screen.getByRole('radio', { name: /no picture/i })).toBeChecked();
      expect(
        screen.getByRole('radio', { name: /picture from your sign-in provider/i }),
      ).not.toBeChecked();
    });

    it('should disable the provider option and explain why when the provider supplied no picture', () => {
      mockAuth(userWithoutProviderImage);

      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      const providerRadio = screen.getByRole('radio', {
        name: /picture from your sign-in provider/i,
      });
      expect(providerRadio).toBeDisabled();
      expect(screen.getByText(/your sign-in provider didn't supply a picture/i)).toBeInTheDocument();
    });

    it('should enable the provider option when the provider supplied a picture', () => {
      mockAuth(userWithProviderImage);

      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      expect(
        screen.getByRole('radio', { name: /picture from your sign-in provider/i }),
      ).toBeEnabled();
    });

    it('should never disable the "no picture" or "upload" options', () => {
      mockAuth(userWithoutProviderImage);

      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      expect(screen.getByRole('radio', { name: /no picture/i })).toBeEnabled();
      expect(screen.getByRole('radio', { name: /upload a picture/i })).toBeEnabled();
    });

    /**
     * KNOWN BUG (#367, found writing this test — reported, not fixed here):
     * every option's `disabled` field is a boolean literal (`false`, `false`,
     * or `!providerUrl`), never `undefined`. MUI's `FormControlLabel` only
     * falls through to the fieldset's `disabled` via `disabledProp ??
     * muiFormControl?.disabled`, and a literal `false` short-circuits that —
     * so `controlsDisabled` (driven by the `disabled` prop / `isBusy`) never
     * reaches the "No picture" or "Upload a picture" radios, and "Picture
     * from your sign-in provider" is gated only by `providerUrl`. Passing
     * `disabled` to `ProfileSettings` disables the display name field and the
     * Save button, but NOT the radio group — a user (or a screen-reader
     * user tabbing through) can still change the selection while the page is
     * supposedly read-only or a save is in flight.
     */
    it('does not disable the radio options via the page-level disabled prop (documents a bug)', () => {
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} disabled />);

      expect(screen.getByLabelText(/display name/i)).toBeDisabled();
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
      expect(screen.getByRole('radio', { name: /no picture/i })).toBeEnabled();
      expect(screen.getByRole('radio', { name: /upload a picture/i })).toBeEnabled();
    });
  });

  describe('Selecting none or provider', () => {
    it('should enable save and patch imageSource when switching to none', async () => {
      const user = userEvent.setup();
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      const saveButton = screen.getByRole('button', { name: /save changes/i });
      expect(saveButton).toBeDisabled();

      await user.click(screen.getByRole('radio', { name: /no picture/i }));
      expect(saveButton).toBeEnabled();

      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith({
          displayName: undefined,
          imageSource: 'none',
        });
      });
    });

    it('should enable save and patch imageSource when switching from none to provider', async () => {
      const user = userEvent.setup();
      render(<ProfileSettings profile={noPictureProfile} onSave={mockOnSave} />);

      await user.click(
        screen.getByRole('radio', { name: /picture from your sign-in provider/i }),
      );
      const saveButton = screen.getByRole('button', { name: /save changes/i });
      expect(saveButton).toBeEnabled();

      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith({
          displayName: undefined,
          imageSource: 'provider',
        });
      });
    });

    it('should call refreshUser after a successful save', async () => {
      const user = userEvent.setup();
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      await user.click(screen.getByRole('radio', { name: /no picture/i }));
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(mockRefreshUser).toHaveBeenCalled();
      });
    });

    it('should not include imageSource in the patch when only the display name changes', async () => {
      const user = userEvent.setup();
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      await user.type(screen.getByLabelText(/display name/i), 'New Name');
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith({ displayName: 'New Name' });
      });
    });
  });

  describe('Selecting upload with no picture yet', () => {
    it('should show the upload control without enabling save', async () => {
      const user = userEvent.setup();
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      await user.click(screen.getByRole('radio', { name: /upload a picture/i }));

      expect(screen.getByTestId('image-upload-mock')).toBeInTheDocument();
      // Choosing "Upload" before a picture exists is UI state only — the API
      // rejects `imageSource: 'upload'` with nothing uploaded yet, and the
      // upload endpoint sets the source itself once it succeeds.
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should explain that the current picture stays until an upload succeeds', async () => {
      const user = userEvent.setup();
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      await user.click(screen.getByRole('radio', { name: /upload a picture/i }));

      expect(
        screen.getByText(/your current picture stays in place until an upload succeeds/i),
      ).toBeInTheDocument();
    });

    it('should not show the upload control before "Upload" is selected', () => {
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      expect(screen.queryByTestId('image-upload-mock')).not.toBeInTheDocument();
    });
  });

  describe('Successful upload', () => {
    it('should adopt the returned settings via onSettingsReplaced with a success message', async () => {
      const user = userEvent.setup();
      render(
        <ProfileSettings
          profile={defaultProfile}
          onSave={mockOnSave}
          onSettingsReplaced={mockOnSettingsReplaced}
        />,
      );

      await user.click(screen.getByRole('radio', { name: /upload a picture/i }));
      await user.click(screen.getByTestId('image-upload-mock'));

      await waitFor(() => {
        expect(mockOnSettingsReplaced).toHaveBeenCalledWith(
          {
            theme: 'system',
            profile: { imageSource: 'upload', imageObjectId: 'obj-1' },
            updatedAt: '2024-06-01T00:00:00.000Z',
            version: 5,
          },
          'Profile picture updated',
        );
      });
    });

    it('should call refreshUser after a successful upload', async () => {
      const user = userEvent.setup();
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      await user.click(screen.getByRole('radio', { name: /upload a picture/i }));
      await user.click(screen.getByTestId('image-upload-mock'));

      await waitFor(() => {
        expect(mockRefreshUser).toHaveBeenCalled();
      });
    });

    it('should not call onSave for an upload — it never goes through the PATCH path', async () => {
      const user = userEvent.setup();
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      await user.click(screen.getByRole('radio', { name: /upload a picture/i }));
      await user.click(screen.getByTestId('image-upload-mock'));

      await waitFor(() => {
        expect(mockRefreshUser).toHaveBeenCalled();
      });
      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should show the "Replace picture" label and a remove button once a picture is uploaded', () => {
      render(<ProfileSettings profile={uploadedProfile} onSave={mockOnSave} />);

      expect(screen.getByRole('button', { name: 'Replace picture' })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /remove uploaded picture/i }),
      ).toBeInTheDocument();
    });
  });

  describe('Removing an uploaded picture', () => {
    beforeEach(() => {
      mockDeleteProfileImage.mockResolvedValue({
        settings: {
          theme: 'system',
          profile: { imageSource: 'provider', imageObjectId: null },
          updatedAt: '2024-06-02T00:00:00.000Z',
          version: 6,
        },
        profileImageUrl: null,
      });
    });

    it('should ask for confirmation before removing', async () => {
      const user = userEvent.setup();
      render(<ProfileSettings profile={uploadedProfile} onSave={mockOnSave} />);

      await user.click(screen.getByRole('button', { name: /remove uploaded picture/i }));

      expect(screen.getByText('Remove uploaded picture?')).toBeInTheDocument();
      expect(mockDeleteProfileImage).not.toHaveBeenCalled();
    });

    it('should call the DELETE endpoint only after confirming', async () => {
      const user = userEvent.setup();
      render(<ProfileSettings profile={uploadedProfile} onSave={mockOnSave} />);

      await user.click(screen.getByRole('button', { name: /remove uploaded picture/i }));
      await user.click(screen.getByRole('button', { name: 'Remove' }));

      await waitFor(() => {
        expect(mockDeleteProfileImage).toHaveBeenCalledTimes(1);
      });
    });

    it('should not call the DELETE endpoint when cancelled', async () => {
      const user = userEvent.setup();
      render(<ProfileSettings profile={uploadedProfile} onSave={mockOnSave} />);

      await user.click(screen.getByRole('button', { name: /remove uploaded picture/i }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockDeleteProfileImage).not.toHaveBeenCalled();
      // The Dialog exit transition means the title isn't removed synchronously.
      await waitFor(() => {
        expect(screen.queryByText('Remove uploaded picture?')).not.toBeInTheDocument();
      });
    });

    it('should adopt the returned settings via onSettingsReplaced after removal', async () => {
      const user = userEvent.setup();
      render(
        <ProfileSettings
          profile={uploadedProfile}
          onSave={mockOnSave}
          onSettingsReplaced={mockOnSettingsReplaced}
        />,
      );

      await user.click(screen.getByRole('button', { name: /remove uploaded picture/i }));
      await user.click(screen.getByRole('button', { name: 'Remove' }));

      await waitFor(() => {
        expect(mockOnSettingsReplaced).toHaveBeenCalledWith(
          {
            theme: 'system',
            profile: { imageSource: 'provider', imageObjectId: null },
            updatedAt: '2024-06-02T00:00:00.000Z',
            version: 6,
          },
          'Uploaded picture removed',
        );
      });
    });

    it('should surface a server error message when removal fails', async () => {
      const { ApiError } = await import('../../../services/api');
      mockDeleteProfileImage.mockRejectedValue(new ApiError('Cannot remove right now', 400));
      const user = userEvent.setup();
      render(<ProfileSettings profile={uploadedProfile} onSave={mockOnSave} />);

      await user.click(screen.getByRole('button', { name: /remove uploaded picture/i }));
      await user.click(screen.getByRole('button', { name: 'Remove' }));

      await waitFor(() => {
        expect(screen.getByText('Cannot remove right now')).toBeInTheDocument();
      });
      expect(mockOnSettingsReplaced).not.toHaveBeenCalled();
    });

    it('should fall back to a generic message when removal fails with no server message', async () => {
      const { ApiError } = await import('../../../services/api');
      mockDeleteProfileImage.mockRejectedValue(new ApiError('Request failed', 500));
      const user = userEvent.setup();
      render(<ProfileSettings profile={uploadedProfile} onSave={mockOnSave} />);

      await user.click(screen.getByRole('button', { name: /remove uploaded picture/i }));
      await user.click(screen.getByRole('button', { name: 'Remove' }));

      await waitFor(() => {
        expect(
          screen.getByText(/failed to remove the uploaded picture/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe('Loading State', () => {
    it('should show saving text during save', async () => {
      const user = userEvent.setup();
      let resolveSave: () => void = () => {};
      mockOnSave.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
      );

      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      await user.click(screen.getByRole('radio', { name: /no picture/i }));
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      expect(screen.getByRole('button', { name: /saving\.\.\./i })).toBeInTheDocument();

      resolveSave();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
      });
    });

    it('should disable save button during save', async () => {
      const user = userEvent.setup();
      let resolveSave: () => void = () => {};
      mockOnSave.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
      );

      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      await user.click(screen.getByRole('radio', { name: /no picture/i }));
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      expect(screen.getByRole('button', { name: /saving\.\.\./i })).toBeDisabled();

      resolveSave();
    });
  });

  describe('Change Tracking', () => {
    it('should detect display name changes', async () => {
      const user = userEvent.setup();
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      const saveButton = screen.getByRole('button', { name: /save changes/i });
      expect(saveButton).toBeDisabled();

      await user.type(screen.getByLabelText(/display name/i), 'Change');

      expect(saveButton).toBeEnabled();
    });

    it('should reset changes when the profile prop changes', async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <ProfileSettings profile={defaultProfile} onSave={mockOnSave} />,
      );

      await user.type(screen.getByLabelText(/display name/i), 'Changed Name');
      expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled();

      rerender(
        <ProfileSettings
          profile={{ ...defaultProfile, displayName: 'Server Name' }}
          onSave={mockOnSave}
        />,
      );

      expect(screen.getByLabelText(/display name/i)).toHaveValue('Server Name');
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    });

    it('should disable save when changes are reverted', async () => {
      const user = userEvent.setup();
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} />);

      const displayNameInput = screen.getByLabelText(/display name/i);
      await user.type(displayNameInput, 'New Name');
      expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled();

      await user.clear(displayNameInput);
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    });
  });

  describe('Disabled State', () => {
    it('should disable display name input when disabled prop is true', () => {
      render(<ProfileSettings profile={defaultProfile} onSave={mockOnSave} disabled />);

      expect(screen.getByLabelText(/display name/i)).toBeDisabled();
    });

    it('should disable the save button when disabled prop is true', () => {
      const profile = { ...defaultProfile, displayName: 'Some Name' };

      render(<ProfileSettings profile={profile} onSave={mockOnSave} disabled />);

      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    });

    it('should disable the remove-picture button when disabled prop is true', () => {
      render(<ProfileSettings profile={uploadedProfile} onSave={mockOnSave} disabled />);

      expect(screen.getByRole('button', { name: /remove uploaded picture/i })).toBeDisabled();
    });
  });
});
