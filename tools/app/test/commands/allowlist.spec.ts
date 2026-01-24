import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';

// We need to mock before importing the module under test
const mockApiRequest = jest.fn<any>();
const mockValidateEmail = jest.fn<any>();
const mockSanitizeEmail = jest.fn<any>();

jest.unstable_mockModule('../../src/lib/api-client.js', () => ({
  apiRequest: mockApiRequest,
}));

jest.unstable_mockModule('../../src/lib/validators.js', () => ({
  validateEmail: mockValidateEmail,
  sanitizeEmail: mockSanitizeEmail,
}));

jest.unstable_mockModule('../../src/utils/output.js', () => ({
  header: jest.fn(),
  blank: jest.fn(),
  tableHeader: jest.fn(),
  tableRow: jest.fn(),
  dim: jest.fn(),
  success: jest.fn(),
  error: jest.fn(),
}));

describe('allowlist commands', () => {
  let listAllowlist: any;
  let addToAllowlist: any;
  let removeFromAllowlist: any;

  beforeEach(async () => {
    // Import the module under test after mocks are set up
    const commands = await import('../../src/commands/allowlist.js');
    listAllowlist = commands.listAllowlist;
    addToAllowlist = commands.addToAllowlist;
    removeFromAllowlist = commands.removeFromAllowlist;

    // Reset mocks
    jest.clearAllMocks();

    // Default validator behavior
    mockValidateEmail.mockReturnValue(true);
    mockSanitizeEmail.mockImplementation((email: string) => email.toLowerCase());
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('listAllowlist', () => {
    it('should throw when API returns error', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Forbidden' }),
      });

      await expect(listAllowlist({})).rejects.toThrow('Forbidden');
    });

    it('should throw when API returns 401 (auth error)', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      });

      await expect(listAllowlist({})).rejects.toThrow('Unauthorized');
    });

    it('should throw with default message when error message missing', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });

      await expect(listAllowlist({})).rejects.toThrow(
        'Failed to list allowlist'
      );
    });

    it('should throw when API request fails', async () => {
      mockApiRequest.mockRejectedValue(new Error('Network error'));

      await expect(listAllowlist({})).rejects.toThrow('Network error');
    });

    it('should pass correct query parameters', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            items: [],
            total: 0,
            page: 1,
            limit: 10,
          },
        }),
      });

      await listAllowlist({ page: 2, limit: 10 });

      expect(mockApiRequest).toHaveBeenCalledWith('/allowlist?page=2&limit=10');
    });

    it('should use default page and limit when not provided', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            items: [],
            total: 0,
            page: 1,
            limit: 20,
          },
        }),
      });

      await listAllowlist({});

      expect(mockApiRequest).toHaveBeenCalledWith('/allowlist?page=1&limit=20');
    });

    it('should succeed when API returns valid data', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            items: [
              {
                id: 'entry-1',
                email: 'test@example.com',
                notes: 'Test user',
                status: 'pending',
                addedAt: '2024-01-01T00:00:00Z',
              },
            ],
            total: 1,
            page: 1,
            limit: 20,
          },
        }),
      });

      await expect(listAllowlist({})).resolves.toBeUndefined();
    });

    it('should output JSON when json option is true', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            items: [],
            total: 0,
            page: 1,
            limit: 20,
          },
        }),
      });

      await listAllowlist({ json: true });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('addToAllowlist', () => {
    const email = 'test@example.com';
    const notes = 'Test user';

    it('should throw on invalid email', async () => {
      mockValidateEmail.mockReturnValue('Please enter a valid email address');

      await expect(addToAllowlist('invalid-email')).rejects.toThrow(
        'Please enter a valid email address'
      );

      expect(mockApiRequest).not.toHaveBeenCalled();
    });

    it('should throw when email validation returns error string', async () => {
      mockValidateEmail.mockReturnValue('Email address is required');

      await expect(addToAllowlist('')).rejects.toThrow(
        'Email address is required'
      );

      expect(mockApiRequest).not.toHaveBeenCalled();
    });

    it('should throw when API returns error', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Email already exists' }),
      });

      await expect(addToAllowlist(email)).rejects.toThrow(
        'Email already exists'
      );
    });

    it('should throw when API returns 401 (auth error)', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      });

      await expect(addToAllowlist(email)).rejects.toThrow('Unauthorized');
    });

    it('should throw with default message when error message missing', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });

      await expect(addToAllowlist(email)).rejects.toThrow(
        'Failed to add to allowlist'
      );
    });

    it('should throw when API request fails', async () => {
      mockApiRequest.mockRejectedValue(new Error('Network error'));

      await expect(addToAllowlist(email)).rejects.toThrow('Network error');
    });

    it('should send sanitized email in request body', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'entry-1' } }),
      });

      await addToAllowlist('Test@Example.COM');

      expect(mockSanitizeEmail).toHaveBeenCalledWith('Test@Example.COM');
      expect(mockApiRequest).toHaveBeenCalledWith('/allowlist', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          notes: undefined,
        }),
      });
    });

    it('should include notes when provided', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'entry-1' } }),
      });

      await addToAllowlist(email, notes);

      expect(mockApiRequest).toHaveBeenCalledWith('/allowlist', {
        method: 'POST',
        body: JSON.stringify({
          email: email.toLowerCase(),
          notes,
        }),
      });
    });

    it('should succeed when API returns success', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'entry-1' } }),
      });

      await expect(addToAllowlist(email)).resolves.toBeUndefined();
    });
  });

  describe('removeFromAllowlist', () => {
    const entryId = 'entry-123';

    it('should throw when API returns error', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Entry not found' }),
      });

      await expect(removeFromAllowlist(entryId)).rejects.toThrow(
        'Entry not found'
      );
    });

    it('should throw when API returns 401 (auth error)', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      });

      await expect(removeFromAllowlist(entryId)).rejects.toThrow(
        'Unauthorized'
      );
    });

    it('should throw when API returns 403 (claimed entry)', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          message: 'Cannot remove claimed allowlist entries',
        }),
      });

      await expect(removeFromAllowlist(entryId)).rejects.toThrow(
        'Cannot remove claimed allowlist entries'
      );
    });

    it('should throw with default message when error message missing', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });

      await expect(removeFromAllowlist(entryId)).rejects.toThrow(
        'Failed to remove from allowlist'
      );
    });

    it('should throw when API request fails', async () => {
      mockApiRequest.mockRejectedValue(new Error('Network error'));

      await expect(removeFromAllowlist(entryId)).rejects.toThrow(
        'Network error'
      );
    });

    it('should pass correct entry ID in path', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      await removeFromAllowlist(entryId);

      expect(mockApiRequest).toHaveBeenCalledWith(`/allowlist/${entryId}`, {
        method: 'DELETE',
      });
    });

    it('should succeed when API returns success', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      await expect(removeFromAllowlist(entryId)).resolves.toBeUndefined();
    });
  });
});
