import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';

// We need to mock before importing the module under test
const mockApiRequest = jest.fn<any>();

jest.unstable_mockModule('../../src/lib/api-client.js', () => ({
  apiRequest: mockApiRequest,
}));

jest.unstable_mockModule('../../src/utils/output.js', () => ({
  header: jest.fn(),
  blank: jest.fn(),
  success: jest.fn(),
  error: jest.fn(),
}));

describe('settings commands', () => {
  let getUserSettings: any;
  let updateUserSetting: any;
  let getSystemSettings: any;

  beforeEach(async () => {
    // Import the module under test after mocks are set up
    const commands = await import('../../src/commands/settings.js');
    getUserSettings = commands.getUserSettings;
    updateUserSetting = commands.updateUserSetting;
    getSystemSettings = commands.getSystemSettings;

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('getUserSettings', () => {
    it('should throw when API returns error', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'User settings not found' }),
      });

      await expect(getUserSettings({})).rejects.toThrow(
        'User settings not found'
      );
    });

    it('should throw when API returns 401 (auth error)', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      });

      await expect(getUserSettings({})).rejects.toThrow('Unauthorized');
    });

    it('should throw with default message when error message missing', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });

      await expect(getUserSettings({})).rejects.toThrow(
        'Failed to get user settings'
      );
    });

    it('should throw when API request fails', async () => {
      mockApiRequest.mockRejectedValue(new Error('Network error'));

      await expect(getUserSettings({})).rejects.toThrow('Network error');
    });

    it('should request user settings endpoint', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            theme: 'dark',
            profile: {
              displayName: 'Test User',
              useProviderImage: true,
            },
          },
        }),
      });

      await getUserSettings({});

      expect(mockApiRequest).toHaveBeenCalledWith('/user-settings');
    });

    it('should succeed when API returns valid data', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            theme: 'light',
            profile: {
              displayName: null,
              useProviderImage: true,
            },
          },
        }),
      });

      await expect(getUserSettings({})).resolves.toBeUndefined();
    });

    it('should output JSON when json option is true', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            theme: 'system',
          },
        }),
      });

      await getUserSettings({ json: true });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('updateUserSetting', () => {
    it('should throw when API returns error', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Invalid setting value' }),
      });

      await expect(updateUserSetting('theme', 'dark')).rejects.toThrow(
        'Invalid setting value'
      );
    });

    it('should throw when API returns 401 (auth error)', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      });

      await expect(updateUserSetting('theme', 'dark')).rejects.toThrow(
        'Unauthorized'
      );
    });

    it('should throw when API returns 400 (validation error)', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid theme value' }),
      });

      await expect(updateUserSetting('theme', 'invalid')).rejects.toThrow(
        'Invalid theme value'
      );
    });

    it('should throw with default message when error message missing', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });

      await expect(updateUserSetting('theme', 'dark')).rejects.toThrow(
        'Failed to update setting'
      );
    });

    it('should throw when API request fails', async () => {
      mockApiRequest.mockRejectedValue(new Error('Network error'));

      await expect(updateUserSetting('theme', 'dark')).rejects.toThrow(
        'Network error'
      );
    });

    it('should send PATCH request with key-value pair', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ data: {} }),
      });

      await updateUserSetting('theme', 'dark');

      expect(mockApiRequest).toHaveBeenCalledWith('/user-settings', {
        method: 'PATCH',
        body: JSON.stringify({ theme: 'dark' }),
      });
    });

    it('should parse JSON value when valid JSON string provided', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ data: {} }),
      });

      await updateUserSetting('profile', '{"displayName":"Test"}');

      expect(mockApiRequest).toHaveBeenCalledWith('/user-settings', {
        method: 'PATCH',
        body: JSON.stringify({ profile: { displayName: 'Test' } }),
      });
    });

    it('should use string value when JSON parsing fails', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ data: {} }),
      });

      await updateUserSetting('notes', 'just a string');

      expect(mockApiRequest).toHaveBeenCalledWith('/user-settings', {
        method: 'PATCH',
        body: JSON.stringify({ notes: 'just a string' }),
      });
    });

    it('should parse boolean values', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ data: {} }),
      });

      await updateUserSetting('enabled', 'true');

      expect(mockApiRequest).toHaveBeenCalledWith('/user-settings', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: true }),
      });
    });

    it('should parse numeric values', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ data: {} }),
      });

      await updateUserSetting('count', '42');

      expect(mockApiRequest).toHaveBeenCalledWith('/user-settings', {
        method: 'PATCH',
        body: JSON.stringify({ count: 42 }),
      });
    });

    it('should succeed when API returns success', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { theme: 'dark' } }),
      });

      await expect(updateUserSetting('theme', 'dark')).resolves.toBeUndefined();
    });
  });

  describe('getSystemSettings', () => {
    it('should throw when API returns error', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Access denied' }),
      });

      await expect(getSystemSettings({})).rejects.toThrow('Access denied');
    });

    it('should throw when API returns 401 (auth error)', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      });

      await expect(getSystemSettings({})).rejects.toThrow('Unauthorized');
    });

    it('should throw when API returns 403 (forbidden - not admin)', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ message: 'Admin access required' }),
      });

      await expect(getSystemSettings({})).rejects.toThrow(
        'Admin access required'
      );
    });

    it('should throw with default message when error message missing', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });

      await expect(getSystemSettings({})).rejects.toThrow(
        'Failed to get system settings'
      );
    });

    it('should throw when API request fails', async () => {
      mockApiRequest.mockRejectedValue(new Error('Network error'));

      await expect(getSystemSettings({})).rejects.toThrow('Network error');
    });

    it('should request system settings endpoint', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            ui: {
              allowUserThemeOverride: true,
              defaultTheme: 'system',
            },
          },
        }),
      });

      await getSystemSettings({});

      expect(mockApiRequest).toHaveBeenCalledWith('/system-settings');
    });

    it('should succeed when API returns valid data', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            ui: {
              allowUserThemeOverride: false,
              defaultTheme: 'light',
            },
          },
        }),
      });

      await expect(getSystemSettings({})).resolves.toBeUndefined();
    });

    it('should output JSON when json option is true', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            ui: {
              allowUserThemeOverride: true,
            },
          },
        }),
      });

      await getSystemSettings({ json: true });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
