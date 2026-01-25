import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';

// We need to mock before importing the module under test
const mockCheckHealth = jest.fn<any>();
const mockConfig = { apiUrl: 'http://localhost:3000/api' };

jest.unstable_mockModule('../../src/lib/api-client.js', () => ({
  checkHealth: mockCheckHealth,
}));

jest.unstable_mockModule('../../src/utils/output.js', () => ({
  header: jest.fn(),
  blank: jest.fn(),
  keyValue: jest.fn(),
  success: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
}));

jest.unstable_mockModule('../../src/utils/config.js', () => ({
  config: mockConfig,
}));

describe('health commands', () => {
  let healthCheck: any;

  beforeEach(async () => {
    // Import the module under test after mocks are set up
    const commands = await import('../../src/commands/health.js');
    healthCheck = commands.healthCheck;

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('healthCheck', () => {
    it('should throw when checkHealth throws network error', async () => {
      mockCheckHealth.mockRejectedValue(new Error('Network error'));

      await expect(healthCheck({})).rejects.toThrow('Network error');
    });

    it('should throw when checkHealth throws connection refused', async () => {
      mockCheckHealth.mockRejectedValue(
        new Error('connect ECONNREFUSED 127.0.0.1:3000')
      );

      await expect(healthCheck({})).rejects.toThrow('connect ECONNREFUSED');
    });

    it('should throw when API is unreachable', async () => {
      mockCheckHealth.mockRejectedValue(new Error('fetch failed'));

      await expect(healthCheck({})).rejects.toThrow('fetch failed');
    });

    it('should succeed when API is healthy', async () => {
      mockCheckHealth.mockResolvedValue({
        live: true,
        ready: true,
      });

      await expect(healthCheck({})).resolves.toBeUndefined();
    });

    it('should succeed when API is live but not ready', async () => {
      mockCheckHealth.mockResolvedValue({
        live: true,
        ready: false,
      });

      await expect(healthCheck({})).resolves.toBeUndefined();
    });

    it('should succeed when API is not healthy (returns false)', async () => {
      mockCheckHealth.mockResolvedValue({
        live: false,
        ready: false,
      });

      await expect(healthCheck({})).resolves.toBeUndefined();
    });

    it('should call checkHealth from api-client', async () => {
      mockCheckHealth.mockResolvedValue({
        live: true,
        ready: true,
      });

      await healthCheck({});

      expect(mockCheckHealth).toHaveBeenCalledTimes(1);
    });

    it('should output JSON when json option is true', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      mockCheckHealth.mockResolvedValue({
        live: true,
        ready: true,
      });

      await healthCheck({ json: true });

      expect(consoleSpy).toHaveBeenCalledWith(
        JSON.stringify({ live: true, ready: true }, null, 2)
      );

      consoleSpy.mockRestore();
    });

    it('should format output correctly for healthy API', async () => {
      mockCheckHealth.mockResolvedValue({
        live: true,
        ready: true,
      });

      await expect(healthCheck({})).resolves.toBeUndefined();
    });

    it('should format output correctly for unhealthy API', async () => {
      mockCheckHealth.mockResolvedValue({
        live: false,
        ready: false,
      });

      await expect(healthCheck({})).resolves.toBeUndefined();
    });
  });
});
