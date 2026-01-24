import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../utils/test-utils';
import ActivateDevicePage from '../../pages/ActivateDevicePage';
import type { DeviceActivationInfo, DeviceAuthorizationResponse } from '../../types';

// Import the mocked api from test-utils
import { api, ApiError } from '../../services/api';

const mockApi = vi.mocked(api);

describe('ActivateDevicePage', () => {
  const mockDeviceInfo: DeviceActivationInfo = {
    userCode: 'ABCD-1234',
    clientInfo: {
      deviceName: 'My Smart TV',
      userAgent: 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
      ipAddress: '192.168.1.100',
    },
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 minutes from now
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any timers
    vi.clearAllTimers();
  });

  describe('Rendering', () => {
    it('should render page title', () => {
      render(<ActivateDevicePage />);

      expect(screen.getByRole('heading', { name: /authorize device/i })).toBeInTheDocument();
    });

    it('should render page description', () => {
      render(<ActivateDevicePage />);

      expect(screen.getByText(/link a device to your account/i)).toBeInTheDocument();
    });

    it('should render device code input in initial step', () => {
      render(<ActivateDevicePage />);

      expect(screen.getByLabelText(/device code/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /verify code/i })).toBeInTheDocument();
    });
  });

  describe('Device Code Input Handling', () => {
    it('should accept manual code input', async () => {
      const user = userEvent.setup({ delay: null });
      render(<ActivateDevicePage />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABCD1234');

      expect(input).toHaveValue('ABCD-1234');
    });

    it('should format code with dash automatically', async () => {
      const user = userEvent.setup({ delay: null });
      render(<ActivateDevicePage />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'test5678');

      expect(input).toHaveValue('TEST-5678');
    });

    it('should pre-fill code from URL query parameter', () => {
      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=WXYZ-9876',
        },
      });

      const input = screen.getByLabelText(/device code/i);
      expect(input).toHaveValue('WXYZ-9876');
    });

    it('should auto-verify when code is provided in URL', async () => {
      mockApi.get.mockResolvedValue(mockDeviceInfo);

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      await waitFor(() => {
        expect(mockApi.get).toHaveBeenCalledWith('/auth/device/activate?code=ABCD-1234');
      });
    });

    it('should disable verify button when code is incomplete', async () => {
      const user = userEvent.setup({ delay: null });
      render(<ActivateDevicePage />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABC');

      const verifyButton = screen.getByRole('button', { name: /verify code/i });
      expect(verifyButton).toBeDisabled();
    });

    it('should enable verify button when code is complete', async () => {
      const user = userEvent.setup({ delay: null });
      render(<ActivateDevicePage />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABCD1234');

      const verifyButton = screen.getByRole('button', { name: /verify code/i });
      expect(verifyButton).toBeEnabled();
    });
  });

  describe('Code Verification Flow', () => {
    it('should verify code and transition to review step', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.get.mockResolvedValue(mockDeviceInfo);

      render(<ActivateDevicePage />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABCD1234');

      const verifyButton = screen.getByRole('button', { name: /verify code/i });
      await user.click(verifyButton);

      await waitFor(() => {
        expect(mockApi.get).toHaveBeenCalledWith('/auth/device/activate?code=ABCD-1234');
      });

      await waitFor(() => {
        expect(screen.getByText(/a device is requesting access/i)).toBeInTheDocument();
      });
    });

    it('should display device information after verification', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.get.mockResolvedValue(mockDeviceInfo);

      render(<ActivateDevicePage />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABCD1234');

      const verifyButton = screen.getByRole('button', { name: /verify code/i });
      await user.click(verifyButton);

      await waitFor(() => {
        expect(screen.getByText('My Smart TV')).toBeInTheDocument();
        expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
        expect(screen.getByText(/Mozilla.*Android/)).toBeInTheDocument();
      });
    });

    it('should show loading state while verifying', async () => {
      const user = userEvent.setup({ delay: null });
      let resolvePromise: (value: DeviceActivationInfo) => void;
      const promise = new Promise<DeviceActivationInfo>((resolve) => {
        resolvePromise = resolve;
      });
      mockApi.get.mockReturnValue(promise);

      render(<ActivateDevicePage />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABCD1234');

      const verifyButton = screen.getByRole('button', { name: /verify code/i });
      await user.click(verifyButton);

      expect(screen.getByText(/verifying/i)).toBeInTheDocument();
      expect(verifyButton).toBeDisabled();

      // Resolve the promise
      resolvePromise!(mockDeviceInfo);

      await waitFor(() => {
        expect(screen.getByText(/a device is requesting access/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error for invalid code (404)', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.get.mockRejectedValue(
        new ApiError('Not found', 404)
      );

      render(<ActivateDevicePage />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'INVALID1');

      const verifyButton = screen.getByRole('button', { name: /verify code/i });
      await user.click(verifyButton);

      await waitFor(() => {
        expect(screen.getByText(/invalid code.*please check and try again/i)).toBeInTheDocument();
      });
    });

    it('should display error for expired code (410)', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.get.mockRejectedValue(
        new ApiError('Code expired', 410)
      );

      render(<ActivateDevicePage />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'EXPIRED1');

      const verifyButton = screen.getByRole('button', { name: /verify code/i });
      await user.click(verifyButton);

      await waitFor(() => {
        expect(screen.getByText(/this code has expired.*please request a new one/i)).toBeInTheDocument();
      });
    });

    it('should display error for bad request (400)', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.get.mockRejectedValue(
        new ApiError('Bad request', 400)
      );

      render(<ActivateDevicePage />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'BADREQ01');

      const verifyButton = screen.getByRole('button', { name: /verify code/i });
      await user.click(verifyButton);

      await waitFor(() => {
        expect(screen.getByText(/invalid code.*please check and try again/i)).toBeInTheDocument();
      });
    });

    it('should display generic error for other API errors', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.get.mockRejectedValue(
        new ApiError('Internal server error', 500)
      );

      render(<ActivateDevicePage />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ERROR500');

      const verifyButton = screen.getByRole('button', { name: /verify code/i });
      await user.click(verifyButton);

      await waitFor(() => {
        expect(screen.getByText(/failed to verify code.*please try again/i)).toBeInTheDocument();
      });
    });

    it('should display network error for non-API errors', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.get.mockRejectedValue(
        new Error('Network failure')
      );

      render(<ActivateDevicePage />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'NETWORK1');

      const verifyButton = screen.getByRole('button', { name: /verify code/i });
      await user.click(verifyButton);

      await waitFor(() => {
        expect(screen.getByText(/network error.*please check your connection/i)).toBeInTheDocument();
      });
    });

    it('should clear previous errors when verifying again', async () => {
      const user = userEvent.setup({ delay: null });

      // First attempt fails
      mockApi.get.mockRejectedValueOnce(
        new ApiError('Not found', 404)
      );

      render(<ActivateDevicePage />);

      const input = screen.getByLabelText(/device code/i);
      await user.clear(input);
      await user.type(input, 'INVALID1');

      let verifyButton = screen.getByRole('button', { name: /verify code/i });
      await user.click(verifyButton);

      await waitFor(() => {
        expect(screen.getByText(/invalid code/i)).toBeInTheDocument();
      });

      // Second attempt succeeds
      mockApi.get.mockResolvedValueOnce(mockDeviceInfo);

      await user.clear(input);
      await user.type(input, 'VALID123');

      verifyButton = screen.getByRole('button', { name: /verify code/i });
      await user.click(verifyButton);

      await waitFor(() => {
        expect(screen.queryByText(/invalid code/i)).not.toBeInTheDocument();
        expect(screen.getByText(/a device is requesting access/i)).toBeInTheDocument();
      });
    });
  });

  describe('Device Approval Flow', () => {
    beforeEach(async () => {
      mockApi.get.mockResolvedValue(mockDeviceInfo);
    });

    it('should approve device successfully', async () => {
      const user = userEvent.setup({ delay: null });
      const successResponse: DeviceAuthorizationResponse = {
        success: true,
        message: 'Device authorized successfully!',
      };
      mockApi.post.mockResolvedValue(successResponse);

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      // Wait for auto-verification
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
      });

      const approveButton = screen.getByRole('button', { name: /approve/i });
      await user.click(approveButton);

      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith('/auth/device/authorize', {
          userCode: 'ABCD-1234',
          approve: true,
        });
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /authorization complete/i })).toBeInTheDocument();
        expect(screen.getByText(/device authorized successfully!/i)).toBeInTheDocument();
      });
    });

    it('should show loading state while approving', async () => {
      const user = userEvent.setup({ delay: null });
      let resolvePromise: (value: DeviceAuthorizationResponse) => void;
      const promise = new Promise<DeviceAuthorizationResponse>((resolve) => {
        resolvePromise = resolve;
      });
      mockApi.post.mockReturnValue(promise);

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
      });

      const approveButton = screen.getByRole('button', { name: /approve/i });
      await user.click(approveButton);

      expect(screen.getByText(/approving/i)).toBeInTheDocument();
      expect(approveButton).toBeDisabled();

      // Resolve to prevent hanging
      resolvePromise!({ success: true, message: 'Success' });
    });

    it('should display error when approval fails', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.post.mockRejectedValue(
        new ApiError('Failed to authorize', 500)
      );

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
      });

      const approveButton = screen.getByRole('button', { name: /approve/i });
      await user.click(approveButton);

      await waitFor(() => {
        expect(screen.getByText(/failed to authorize device.*please try again/i)).toBeInTheDocument();
      });

      // Should still be on review step
      expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    });

    it('should handle network error during approval', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.post.mockRejectedValue(
        new Error('Network failure')
      );

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
      });

      const approveButton = screen.getByRole('button', { name: /approve/i });
      await user.click(approveButton);

      await waitFor(() => {
        expect(screen.getByText(/network error.*please check your connection/i)).toBeInTheDocument();
      });
    });
  });

  describe('Device Denial Flow', () => {
    beforeEach(async () => {
      mockApi.get.mockResolvedValue(mockDeviceInfo);
    });

    it('should deny device successfully', async () => {
      const user = userEvent.setup({ delay: null });
      const denialResponse: DeviceAuthorizationResponse = {
        success: false,
        message: 'Device access denied.',
      };
      mockApi.post.mockResolvedValue(denialResponse);

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      // Wait for auto-verification
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
      });

      const denyButton = screen.getByRole('button', { name: /deny/i });
      await user.click(denyButton);

      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith('/auth/device/authorize', {
          userCode: 'ABCD-1234',
          approve: false,
        });
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /authorization complete/i })).toBeInTheDocument();
        expect(screen.getByText(/device access denied/i)).toBeInTheDocument();
      });
    });

    it('should show loading state while denying', async () => {
      const user = userEvent.setup({ delay: null });
      let resolvePromise: (value: DeviceAuthorizationResponse) => void;
      const promise = new Promise<DeviceAuthorizationResponse>((resolve) => {
        resolvePromise = resolve;
      });
      mockApi.post.mockReturnValue(promise);

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
      });

      const denyButton = screen.getByRole('button', { name: /deny/i });
      await user.click(denyButton);

      expect(screen.getByText(/denying/i)).toBeInTheDocument();
      expect(denyButton).toBeDisabled();

      // Resolve to prevent hanging
      resolvePromise!({ success: false, message: 'Denied' });
    });

    it('should display error when denial fails', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.post.mockRejectedValue(
        new ApiError('Failed to process', 500)
      );

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
      });

      const denyButton = screen.getByRole('button', { name: /deny/i });
      await user.click(denyButton);

      await waitFor(() => {
        expect(screen.getByText(/failed to process request.*please try again/i)).toBeInTheDocument();
      });

      // Should still be on review step
      expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
    });
  });

  describe('Success/Completion Step', () => {
    beforeEach(async () => {
      mockApi.get.mockResolvedValue(mockDeviceInfo);
    });

    it('should display success message and icon for approved device', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.post.mockResolvedValue({
        success: true,
        message: 'Device authorized successfully!',
      });

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
      });

      const approveButton = screen.getByRole('button', { name: /approve/i });
      await user.click(approveButton);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /device authorized!/i })).toBeInTheDocument();
        expect(screen.getByText(/device authorized successfully!/i)).toBeInTheDocument();
      });
    });

    it('should display denial message for denied device', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.post.mockResolvedValue({
        success: false,
        message: 'Device access denied.',
      });

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
      });

      const denyButton = screen.getByRole('button', { name: /deny/i });
      await user.click(denyButton);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /device access denied/i })).toBeInTheDocument();
        expect(screen.getByText(/device access denied\./i)).toBeInTheDocument();
      });
    });

    it('should show "Go to Home" button after completion', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.post.mockResolvedValue({
        success: true,
        message: 'Success',
      });

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
      });

      const approveButton = screen.getByRole('button', { name: /approve/i });
      await user.click(approveButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /go to home/i })).toBeInTheDocument();
      });
    });

    it('should show "Try Another Code" button after denial', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.post.mockResolvedValue({
        success: false,
        message: 'Denied',
      });

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
      });

      const denyButton = screen.getByRole('button', { name: /deny/i });
      await user.click(denyButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /try another code/i })).toBeInTheDocument();
      });
    });

    it('should display custom success message from API', async () => {
      const user = userEvent.setup({ delay: null });
      const customMessage = 'Your Smart TV has been connected to your account.';
      mockApi.post.mockResolvedValue({
        success: true,
        message: customMessage,
      });

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
      });

      const approveButton = screen.getByRole('button', { name: /approve/i });
      await user.click(approveButton);

      await waitFor(() => {
        expect(screen.getByText(customMessage)).toBeInTheDocument();
      });
    });
  });

  describe('Step Transitions', () => {
    it('should transition through all steps for approval flow', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.get.mockResolvedValue(mockDeviceInfo);
      mockApi.post.mockResolvedValue({
        success: true,
        message: 'Success',
      });

      render(<ActivateDevicePage />);

      // Step 1: Input
      expect(screen.getByLabelText(/device code/i)).toBeInTheDocument();

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABCD1234');

      const verifyButton = screen.getByRole('button', { name: /verify code/i });
      await user.click(verifyButton);

      // Step 2: Review
      await waitFor(() => {
        expect(screen.getByText(/a device is requesting access/i)).toBeInTheDocument();
      });

      const approveButton = screen.getByRole('button', { name: /approve/i });
      await user.click(approveButton);

      // Step 3: Complete
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /authorization complete/i })).toBeInTheDocument();
      });
    });

    it('should change header text on completion step', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.get.mockResolvedValue(mockDeviceInfo);
      mockApi.post.mockResolvedValue({
        success: true,
        message: 'Success',
      });

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /authorize device/i })).toBeInTheDocument();
      });

      const approveButton = screen.getByRole('button', { name: /approve/i });
      await user.click(approveButton);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /authorization complete/i })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /authorize device/i })).not.toBeInTheDocument();
      });
    });

    it('should not show description on completion step', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.get.mockResolvedValue(mockDeviceInfo);
      mockApi.post.mockResolvedValue({
        success: true,
        message: 'Success',
      });

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      await waitFor(() => {
        expect(screen.getByText(/link a device to your account/i)).toBeInTheDocument();
      });

      const approveButton = screen.getByRole('button', { name: /approve/i });
      await user.click(approveButton);

      await waitFor(() => {
        expect(screen.queryByText(/link a device to your account/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('UI State Management', () => {
    it('should disable buttons while processing', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.get.mockResolvedValue(mockDeviceInfo);
      mockApi.post.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
      });

      const approveButton = screen.getByRole('button', { name: /approve/i });
      const denyButton = screen.getByRole('button', { name: /deny/i });

      await user.click(approveButton);

      await waitFor(() => {
        expect(approveButton).toBeDisabled();
        expect(denyButton).toBeDisabled();
      });
    });

    it('should clear errors before new authorization attempt', async () => {
      const user = userEvent.setup({ delay: null });
      mockApi.get.mockResolvedValue(mockDeviceInfo);

      // First approval fails
      mockApi.post.mockRejectedValueOnce(
        new ApiError('Failed', 500)
      );

      render(<ActivateDevicePage />, {
        wrapperOptions: {
          route: '/activate-device?code=ABCD-1234',
        },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
      });

      let approveButton = screen.getByRole('button', { name: /approve/i });
      await user.click(approveButton);

      await waitFor(() => {
        expect(screen.getByText(/failed.*please try again/i)).toBeInTheDocument();
      });

      // Second approval succeeds
      mockApi.post.mockResolvedValueOnce({
        success: true,
        message: 'Success',
      });

      approveButton = screen.getByRole('button', { name: /approve/i });
      await user.click(approveButton);

      // Error should be cleared before the new request
      await waitFor(() => {
        expect(screen.queryByText(/failed.*please try again/i)).not.toBeInTheDocument();
      });
    });
  });
});
