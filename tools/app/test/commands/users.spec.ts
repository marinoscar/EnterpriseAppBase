import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';

// We need to mock before importing the module under test
const mockApiRequest = jest.fn<any>();

jest.unstable_mockModule('../../src/lib/api-client.js', () => ({
  apiRequest: mockApiRequest,
}));

jest.unstable_mockModule('../../src/utils/output.js', () => ({
  header: jest.fn(),
  blank: jest.fn(),
  tableHeader: jest.fn(),
  tableRow: jest.fn(),
  dim: jest.fn(),
  keyValue: jest.fn(),
}));

describe('users commands', () => {
  let listUsers: any;
  let getUser: any;

  beforeEach(async () => {
    // Import the module under test after mocks are set up
    const commands = await import('../../src/commands/users.js');
    listUsers = commands.listUsers;
    getUser = commands.getUser;

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('listUsers', () => {
    it('should throw when API returns error', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Forbidden' }),
      });

      await expect(listUsers({})).rejects.toThrow('Forbidden');
    });

    it('should throw when API returns 401 (auth error)', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      });

      await expect(listUsers({})).rejects.toThrow('Unauthorized');
    });

    it('should throw with default message when error message missing', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });

      await expect(listUsers({})).rejects.toThrow('Failed to list users');
    });

    it('should throw when API request fails', async () => {
      mockApiRequest.mockRejectedValue(new Error('Network error'));

      await expect(listUsers({})).rejects.toThrow('Network error');
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

      await listUsers({ page: 2, limit: 10 });

      expect(mockApiRequest).toHaveBeenCalledWith('/users?page=2&limit=10');
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

      await listUsers({});

      expect(mockApiRequest).toHaveBeenCalledWith('/users?page=1&limit=20');
    });

    it('should succeed when API returns valid data', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            items: [
              {
                id: 'user-1',
                email: 'test@example.com',
                displayName: 'Test User',
                isActive: true,
                roles: ['Admin'],
                createdAt: '2024-01-01T00:00:00Z',
              },
            ],
            total: 1,
            page: 1,
            limit: 20,
          },
        }),
      });

      await expect(listUsers({})).resolves.toBeUndefined();
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

      await listUsers({ json: true });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('getUser', () => {
    const userId = 'user-123';

    it('should throw when API returns error', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'User not found' }),
      });

      await expect(getUser(userId, {})).rejects.toThrow('User not found');
    });

    it('should throw when API returns 401 (auth error)', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      });

      await expect(getUser(userId, {})).rejects.toThrow('Unauthorized');
    });

    it('should throw with default message when error message missing', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });

      await expect(getUser(userId, {})).rejects.toThrow('Failed to get user');
    });

    it('should throw when API request fails', async () => {
      mockApiRequest.mockRejectedValue(new Error('Network error'));

      await expect(getUser(userId, {})).rejects.toThrow('Network error');
    });

    it('should pass correct user ID in path', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            id: userId,
            email: 'test@example.com',
            displayName: 'Test User',
            isActive: true,
            roles: ['Viewer'],
            createdAt: '2024-01-01T00:00:00Z',
          },
        }),
      });

      await getUser(userId, {});

      expect(mockApiRequest).toHaveBeenCalledWith(`/users/${userId}`);
    });

    it('should succeed when API returns valid data', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            id: userId,
            email: 'test@example.com',
            displayName: 'Test User',
            isActive: true,
            roles: ['Contributor'],
            createdAt: '2024-01-01T00:00:00Z',
          },
        }),
      });

      await expect(getUser(userId, {})).resolves.toBeUndefined();
    });

    it('should output JSON when json option is true', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            id: userId,
            email: 'test@example.com',
            displayName: 'Test User',
            isActive: true,
            roles: ['Admin'],
            createdAt: '2024-01-01T00:00:00Z',
          },
        }),
      });

      await getUser(userId, { json: true });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
