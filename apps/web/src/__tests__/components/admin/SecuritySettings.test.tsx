import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockAdminUser } from '../../utils/test-utils';
import { SecuritySettings } from '../../../components/admin/SecuritySettings';

describe('SecuritySettings', () => {
  const mockOnSave = vi.fn();

  const defaultSettings = {
    jwtAccessTtlMinutes: 15,
    refreshTtlDays: 14,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSave.mockResolvedValue(undefined);
  });

  describe('Rendering', () => {
    it('should render security settings heading', () => {
      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      expect(screen.getByText('Security Settings')).toBeInTheDocument();
    });

    it('should show warning alert about TTL changes', () => {
      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      expect(
        screen.getByText(
          /Changes to token TTL will affect new sessions only/i
        )
      ).toBeInTheDocument();
    });

    it('should render access token TTL input with current value', () => {
      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      ) as HTMLInputElement;
      expect(accessTtlInput).toBeInTheDocument();
      expect(accessTtlInput.value).toBe('15');
    });

    it('should render refresh token TTL input with current value', () => {
      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const refreshTtlInput = screen.getByLabelText(
        /refresh token ttl \(days\)/i
      ) as HTMLInputElement;
      expect(refreshTtlInput).toBeInTheDocument();
      expect(refreshTtlInput.value).toBe('14');
    });

    it('should show helper text for access token TTL', () => {
      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      expect(
        screen.getByText(/How long access tokens are valid \(1-60 minutes\)/i)
      ).toBeInTheDocument();
    });

    it('should show helper text for refresh token TTL', () => {
      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      expect(
        screen.getByText(/How long refresh tokens are valid \(1-90 days\)/i)
      ).toBeInTheDocument();
    });

    it('should render save button', () => {
      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      expect(
        screen.getByRole('button', { name: /save changes/i })
      ).toBeInTheDocument();
    });
  });

  describe('Initial State', () => {
    it('should disable save button when no changes made', () => {
      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });
      expect(saveButton).toBeDisabled();
    });

    it('should update fields when settings prop changes', async () => {
      const { rerender } = render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const newSettings = {
        jwtAccessTtlMinutes: 30,
        refreshTtlDays: 7,
      };

      rerender(
        <SecuritySettings settings={newSettings} onSave={mockOnSave} />
      );

      await waitFor(() => {
        const accessTtlInput = screen.getByLabelText(
          /access token ttl \(minutes\)/i
        ) as HTMLInputElement;
        const refreshTtlInput = screen.getByLabelText(
          /refresh token ttl \(days\)/i
        ) as HTMLInputElement;

        expect(accessTtlInput.value).toBe('30');
        expect(refreshTtlInput.value).toBe('7');
      });
    });
  });

  describe('User Input', () => {
    it('should enable save button when access token TTL is changed', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      );

      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '20');

      await waitFor(() => {
        const saveButton = screen.getByRole('button', {
          name: /save changes/i,
        });
        expect(saveButton).not.toBeDisabled();
      });
    });

    it('should enable save button when refresh token TTL is changed', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const refreshTtlInput = screen.getByLabelText(
        /refresh token ttl \(days\)/i
      );

      await user.clear(refreshTtlInput);
      await user.type(refreshTtlInput, '30');

      await waitFor(() => {
        const saveButton = screen.getByRole('button', {
          name: /save changes/i,
        });
        expect(saveButton).not.toBeDisabled();
      });
    });

    it('should update input value when typing', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      ) as HTMLInputElement;

      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '45');

      expect(accessTtlInput.value).toBe('45');
    });
  });

  describe('Validation', () => {
    it('should show error when access token TTL is below minimum (1)', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      );
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '0');
      await user.click(saveButton);

      await waitFor(() => {
        expect(
          screen.getByText(
            /Access token TTL must be between 1 and 60 minutes/i
          )
        ).toBeInTheDocument();
      });

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should show error when access token TTL is above maximum (60)', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      );
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '61');
      await user.click(saveButton);

      await waitFor(() => {
        expect(
          screen.getByText(
            /Access token TTL must be between 1 and 60 minutes/i
          )
        ).toBeInTheDocument();
      });

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should show error when refresh token TTL is below minimum (1)', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const refreshTtlInput = screen.getByLabelText(
        /refresh token ttl \(days\)/i
      );
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(refreshTtlInput);
      await user.type(refreshTtlInput, '0');
      await user.click(saveButton);

      await waitFor(() => {
        expect(
          screen.getByText(/Refresh token TTL must be between 1 and 90 days/i)
        ).toBeInTheDocument();
      });

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should show error when refresh token TTL is above maximum (90)', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const refreshTtlInput = screen.getByLabelText(
        /refresh token ttl \(days\)/i
      );
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(refreshTtlInput);
      await user.type(refreshTtlInput, '91');
      await user.click(saveButton);

      await waitFor(() => {
        expect(
          screen.getByText(/Refresh token TTL must be between 1 and 90 days/i)
        ).toBeInTheDocument();
      });

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should accept valid access token TTL at minimum boundary (1)', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      );
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '1');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith({
          jwtAccessTtlMinutes: 1,
          refreshTtlDays: 14,
        });
      });
    });

    it('should accept valid access token TTL at maximum boundary (60)', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      );
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '60');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith({
          jwtAccessTtlMinutes: 60,
          refreshTtlDays: 14,
        });
      });
    });

    it('should accept valid refresh token TTL at minimum boundary (1)', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const refreshTtlInput = screen.getByLabelText(
        /refresh token ttl \(days\)/i
      );
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(refreshTtlInput);
      await user.type(refreshTtlInput, '1');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith({
          jwtAccessTtlMinutes: 15,
          refreshTtlDays: 1,
        });
      });
    });

    it('should accept valid refresh token TTL at maximum boundary (90)', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const refreshTtlInput = screen.getByLabelText(
        /refresh token ttl \(days\)/i
      );
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(refreshTtlInput);
      await user.type(refreshTtlInput, '90');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith({
          jwtAccessTtlMinutes: 15,
          refreshTtlDays: 90,
        });
      });
    });

    it('should clear error message when valid input is provided', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      );
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      // First, enter invalid value
      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '0');
      await user.click(saveButton);

      await waitFor(() => {
        expect(
          screen.getByText(
            /Access token TTL must be between 1 and 60 minutes/i
          )
        ).toBeInTheDocument();
      });

      // Then, enter valid value
      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '30');
      await user.click(saveButton);

      await waitFor(() => {
        expect(
          screen.queryByText(/Access token TTL must be between 1 and 60 minutes/i)
        ).not.toBeInTheDocument();
      });

      expect(mockOnSave).toHaveBeenCalledWith({
        jwtAccessTtlMinutes: 30,
        refreshTtlDays: 14,
      });
    });
  });

  describe('Save Functionality', () => {
    it('should call onSave with updated values when save button clicked', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      );
      const refreshTtlInput = screen.getByLabelText(
        /refresh token ttl \(days\)/i
      );
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '30');
      await user.clear(refreshTtlInput);
      await user.type(refreshTtlInput, '7');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith({
          jwtAccessTtlMinutes: 30,
          refreshTtlDays: 7,
        });
      });
    });

    it('should call onSave only once on button click', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      );
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '20');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Loading State', () => {
    it('should show "Saving..." text when save is in progress', async () => {
      const user = userEvent.setup();
      const slowSave = vi.fn(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      render(
        <SecuritySettings settings={defaultSettings} onSave={slowSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      );
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '20');
      await user.click(saveButton);

      expect(
        screen.getByRole('button', { name: /saving\.\.\./i })
      ).toBeInTheDocument();
    });

    it('should disable save button while saving', async () => {
      const user = userEvent.setup();
      const slowSave = vi.fn(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      render(
        <SecuritySettings settings={defaultSettings} onSave={slowSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      );
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '20');
      await user.click(saveButton);

      const savingButton = screen.getByRole('button', { name: /saving\.\.\./i });
      expect(savingButton).toBeDisabled();
    });

    it('should re-enable save button after save completes', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      );
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '20');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalled();
      });

      // Button text should be back to "Save Changes" (not "Saving...")
      await waitFor(() => {
        const button = screen.getByRole('button', { name: /save changes/i });
        expect(button).toBeInTheDocument();
      });

      // Button will still be enabled because local state (20) differs from prop (15)
      // In a real scenario, the parent would update the settings prop after save
      const button = screen.getByRole('button', { name: /save changes/i });
      expect(button).not.toBeDisabled();
    });

    it('should re-enable save button even if save fails', async () => {
      const user = userEvent.setup();

      // Suppress console errors for this test since we're intentionally testing error handling
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const failingSave = vi.fn(async () => {
        throw new Error('Save failed');
      });

      render(
        <SecuritySettings settings={defaultSettings} onSave={failingSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      );
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '20');
      await user.click(saveButton);

      await waitFor(() => {
        expect(failingSave).toHaveBeenCalled();
      });

      // Button should be enabled again (still has changes)
      await waitFor(() => {
        const button = screen.getByRole('button', { name: /save changes/i });
        expect(button).not.toBeDisabled();
      });

      consoleSpy.mockRestore();
    });
  });

  describe('Disabled State', () => {
    it('should disable access token input when disabled prop is true', () => {
      render(
        <SecuritySettings
          settings={defaultSettings}
          onSave={mockOnSave}
          disabled={true}
        />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      );
      expect(accessTtlInput).toBeDisabled();
    });

    it('should disable refresh token input when disabled prop is true', () => {
      render(
        <SecuritySettings
          settings={defaultSettings}
          onSave={mockOnSave}
          disabled={true}
        />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const refreshTtlInput = screen.getByLabelText(
        /refresh token ttl \(days\)/i
      );
      expect(refreshTtlInput).toBeDisabled();
    });

    it('should disable save button when disabled prop is true', () => {
      render(
        <SecuritySettings
          settings={defaultSettings}
          onSave={mockOnSave}
          disabled={true}
        />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });
      expect(saveButton).toBeDisabled();
    });

    it('should not disable inputs when disabled prop is false', () => {
      render(
        <SecuritySettings
          settings={defaultSettings}
          onSave={mockOnSave}
          disabled={false}
        />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      );
      const refreshTtlInput = screen.getByLabelText(
        /refresh token ttl \(days\)/i
      );

      expect(accessTtlInput).not.toBeDisabled();
      expect(refreshTtlInput).not.toBeDisabled();
    });

    it('should not disable inputs when disabled prop is undefined', () => {
      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      );
      const refreshTtlInput = screen.getByLabelText(
        /refresh token ttl \(days\)/i
      );

      expect(accessTtlInput).not.toBeDisabled();
      expect(refreshTtlInput).not.toBeDisabled();
    });
  });

  describe('Error Handling', () => {
    it('should not show error alert initially', () => {
      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const errorAlerts = screen.queryAllByRole('alert');
      const errorAlert = errorAlerts.find(
        (alert) => alert.className.includes('MuiAlert-standardError')
      );
      expect(errorAlert).toBeUndefined();
    });

    it('should show error alert with validation message', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      );
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '100');
      await user.click(saveButton);

      await waitFor(() => {
        const alerts = screen.getAllByRole('alert');
        const errorAlert = alerts.find((alert) =>
          alert.textContent?.includes('Access token TTL must be between')
        );
        expect(errorAlert).toBeInTheDocument();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle non-numeric input gracefully', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      ) as HTMLInputElement;

      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, 'abc');

      // Non-numeric input should result in 0
      expect(accessTtlInput.value).toBe('0');
    });

    it('should handle decimal numbers by converting to integer', async () => {
      const user = userEvent.setup();

      render(
        <SecuritySettings settings={defaultSettings} onSave={mockOnSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      ) as HTMLInputElement;
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '25.7');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith({
          jwtAccessTtlMinutes: 25,
          refreshTtlDays: 14,
        });
      });
    });

    it('should preserve valid value after failed save', async () => {
      const user = userEvent.setup();

      // Suppress console errors for this test since we're intentionally testing error handling
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const failingSave = vi.fn(async () => {
        throw new Error('Network error');
      });

      render(
        <SecuritySettings settings={defaultSettings} onSave={failingSave} />,
        { wrapperOptions: { user: mockAdminUser } }
      );

      const accessTtlInput = screen.getByLabelText(
        /access token ttl \(minutes\)/i
      ) as HTMLInputElement;
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });

      await user.clear(accessTtlInput);
      await user.type(accessTtlInput, '30');
      await user.click(saveButton);

      await waitFor(() => {
        expect(failingSave).toHaveBeenCalled();
      });

      // Value should still be 30
      expect(accessTtlInput.value).toBe('30');

      consoleSpy.mockRestore();
    });
  });
});
