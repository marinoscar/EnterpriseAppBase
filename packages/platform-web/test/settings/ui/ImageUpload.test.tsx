import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { render } from './test-utils.js';
import { ImageUpload, PROFILE_IMAGE_MAX_BYTES } from '../../../src/settings/ui/ImageUpload.js';
import type { ProfileImageMutationResponse } from '../../../src/settings/headless/profile-image.js';
import { createTestApiError } from '../../../src/testing/index.js';

// The upload goes through the profile image client; stub it so the component's
// own behaviour (pre-checks, states, error copy) is what is under test. The
// client itself is covered in profile-image.test.ts.
const mockUpload = vi.hoisted(() => vi.fn());
vi.mock('../../../src/settings/headless/profile-image.js', () => ({
  useProfileImageClient: () => ({ upload: mockUpload, remove: vi.fn(), preview: vi.fn() }),
}));

function makeFile(opts: { type?: string; size?: number; name?: string } = {}): File {
  const { type = 'image/png', size = 1024, name = 'photo.png' } = opts;
  return new File([new Uint8Array(size)], name, { type });
}

const successResult: ProfileImageMutationResponse = {
  settings: {
    theme: 'system',
    profile: { imageSource: 'upload', imageObjectId: 'obj-1' },
    updatedAt: '2024-06-01T00:00:00.000Z',
    version: 2,
  },
  profileImageUrl: 'https://example.com/uploaded.jpg',
};

describe('ImageUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('client-side validation', () => {
    it('rejects an unsupported file type without calling the API', async () => {
      // `applyAccept: false`: the input's `accept` attribute otherwise makes
      // user-event silently drop a file that doesn't match it (mirroring a
      // native file picker), which would never exercise the component's own
      // belt-and-suspenders type check below.
      const user = userEvent.setup({ applyAccept: false });
      const onUploaded = vi.fn();
      render(<ImageUpload onUploaded={onUploaded} />);

      const input = screen.getByTestId('profile-image-file-input') as HTMLInputElement;
      await user.upload(input, makeFile({ type: 'image/svg+xml' }));

      expect(
        screen.getByText(/please choose a jpeg, png, gif or webp image/i),
      ).toBeInTheDocument();
      expect(mockUpload).not.toHaveBeenCalled();
      expect(onUploaded).not.toHaveBeenCalled();
    });

    it('rejects an oversized file without calling the API', async () => {
      const onUploaded = vi.fn();
      render(<ImageUpload onUploaded={onUploaded} />);

      const input = screen.getByTestId('profile-image-file-input') as HTMLInputElement;
      await userEvent.upload(input, makeFile({ size: PROFILE_IMAGE_MAX_BYTES + 1 }));

      expect(screen.getByText(/must be 5 mb or smaller/i)).toBeInTheDocument();
      expect(mockUpload).not.toHaveBeenCalled();
      expect(onUploaded).not.toHaveBeenCalled();
    });
  });

  describe('upload flow', () => {
    it('uploads a valid file and reports the result to the caller', async () => {
      mockUpload.mockResolvedValue(successResult);
      const onUploaded = vi.fn();
      render(<ImageUpload onUploaded={onUploaded} />);

      const input = screen.getByTestId('profile-image-file-input') as HTMLInputElement;
      const file = makeFile();
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(onUploaded).toHaveBeenCalledWith(successResult, expect.any(File));
      });
      expect(mockUpload).toHaveBeenCalledTimes(1);
      expect(mockUpload).toHaveBeenCalledWith(expect.any(File));
    });

    it('shows the uploading state while the request is in flight', async () => {
      let resolveUpload: (value: ProfileImageMutationResponse) => void = () => {};
      mockUpload.mockReturnValue(
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
      );
      const onUploadingChange = vi.fn();
      render(<ImageUpload onUploaded={vi.fn()} onUploadingChange={onUploadingChange} />);

      const input = screen.getByTestId('profile-image-file-input') as HTMLInputElement;
      await userEvent.upload(input, makeFile());

      expect(screen.getByRole('button', { name: /uploading/i })).toBeInTheDocument();
      expect(onUploadingChange).toHaveBeenCalledWith(true);

      resolveUpload(successResult);

      await waitFor(() => {
        expect(onUploadingChange).toHaveBeenLastCalledWith(false);
      });
    });

    it('uses the provided label when not uploading', () => {
      render(<ImageUpload onUploaded={vi.fn()} label="Replace picture" />);

      expect(screen.getByRole('button', { name: 'Replace picture' })).toBeInTheDocument();
    });

    it('disables the control when the disabled prop is true', () => {
      render(<ImageUpload onUploaded={vi.fn()} disabled />);

      expect(screen.getByRole('button', { name: /upload picture/i })).toBeDisabled();
      expect(screen.getByTestId('profile-image-file-input')).toBeDisabled();
    });
  });

  describe('server error handling', () => {
    it('surfaces the server error message on failure', async () => {
      mockUpload.mockRejectedValue(createTestApiError(400, 'That image is not allowed', 'BAD_IMAGE'));
      render(<ImageUpload onUploaded={vi.fn()} />);

      const input = screen.getByTestId('profile-image-file-input') as HTMLInputElement;
      await userEvent.upload(input, makeFile());

      await waitFor(() => {
        expect(screen.getByText('That image is not allowed')).toBeInTheDocument();
      });
    });

    it('falls back to a size-specific message for a 413 with no server message', async () => {
      mockUpload.mockRejectedValue(createTestApiError(413, 'Request failed'));
      render(<ImageUpload onUploaded={vi.fn()} />);

      const input = screen.getByTestId('profile-image-file-input') as HTMLInputElement;
      await userEvent.upload(input, makeFile());

      await waitFor(() => {
        expect(screen.getByText(/must be 5 mb or smaller/i)).toBeInTheDocument();
      });
    });

    it('falls back to a format-specific message for a 400 with no server message', async () => {
      mockUpload.mockRejectedValue(createTestApiError(400, 'Request failed'));
      render(<ImageUpload onUploaded={vi.fn()} />);

      const input = screen.getByTestId('profile-image-file-input') as HTMLInputElement;
      await userEvent.upload(input, makeFile());

      await waitFor(() => {
        expect(
          screen.getByText(/not a supported image \(jpeg, png, gif or webp\)/i),
        ).toBeInTheDocument();
      });
    });

    it('resets the uploading state after a failure', async () => {
      mockUpload.mockRejectedValue(createTestApiError(500, 'Failed'));
      const onUploadingChange = vi.fn();
      render(<ImageUpload onUploaded={vi.fn()} onUploadingChange={onUploadingChange} />);

      const input = screen.getByTestId('profile-image-file-input') as HTMLInputElement;
      await userEvent.upload(input, makeFile());

      await waitFor(() => {
        expect(onUploadingChange).toHaveBeenLastCalledWith(false);
      });
      expect(screen.getByRole('button', { name: /upload picture/i })).toBeInTheDocument();
    });
  });
});
