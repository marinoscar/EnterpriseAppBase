import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * These tests use a real temporary directory instead of mocking fs.
 * This is simpler and more reliable for ES modules.
 */
describe('config-store (integration)', () => {
  let testConfigDir: string;
  let configFile: string;
  let originalEnv: NodeJS.ProcessEnv;
  let configStore: typeof import('../src/lib/config-store.js');

  beforeEach(async () => {
    // Save original environment
    originalEnv = { ...process.env };

    // Create a unique temporary directory for this test
    testConfigDir = join(tmpdir(), `app-cli-test-${Date.now()}`);
    configFile = join(testConfigDir, 'config.json');

    // Set environment to use our test config dir
    process.env.APP_CONFIG_DIR = testConfigDir;

    // Clear URL environment variables
    delete process.env.APP_URL;
    delete process.env.APP_API_URL;

    // Import the module (fresh import for each test)
    configStore = await import('../src/lib/config-store.js');
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;

    // Clean up test config directory
    if (existsSync(configFile)) {
      unlinkSync(configFile);
    }
    if (existsSync(testConfigDir)) {
      rmdirSync(testConfigDir, { recursive: true });
    }
  });

  describe('loadConfig', () => {
    it('should return empty object when no config exists', () => {
      const config = configStore.loadConfig();
      expect(config).toEqual({});
    });

    it('should load config from file when it exists', () => {
      const configData = { appUrl: 'https://example.com' };
      mkdirSync(testConfigDir, { recursive: true });
      writeFileSync(configFile, JSON.stringify(configData));

      const config = configStore.loadConfig();
      expect(config).toEqual(configData);
    });

    it('should return empty object if config file is corrupted', () => {
      mkdirSync(testConfigDir, { recursive: true });
      writeFileSync(configFile, 'invalid json');

      const config = configStore.loadConfig();
      expect(config).toEqual({});
    });
  });

  describe('saveConfig', () => {
    it('should save config to file', () => {
      const config = { appUrl: 'https://example.com' };

      configStore.saveConfig(config);

      expect(existsSync(configFile)).toBe(true);
      const savedContent = readFileSync(configFile, 'utf-8');
      expect(JSON.parse(savedContent)).toEqual(config);
    });

    it('should create config directory if it does not exist', () => {
      const config = { appUrl: 'https://example.com' };

      configStore.saveConfig(config);

      expect(existsSync(testConfigDir)).toBe(true);
      expect(existsSync(configFile)).toBe(true);
    });
  });

  describe('getAppUrl', () => {
    it('should return default URL when nothing is configured', () => {
      const url = configStore.getAppUrl();
      expect(url).toBe('http://localhost:3535');
    });

    it('should return URL from environment variable', () => {
      process.env.APP_URL = 'https://env.example.com';

      const url = configStore.getAppUrl();
      expect(url).toBe('https://env.example.com');
    });

    it('should return URL from config file', () => {
      mkdirSync(testConfigDir, { recursive: true });
      writeFileSync(
        configFile,
        JSON.stringify({ appUrl: 'https://config.example.com' })
      );

      const url = configStore.getAppUrl();
      expect(url).toBe('https://config.example.com');
    });

    it('should prioritize env var over config file', () => {
      process.env.APP_URL = 'https://env.example.com';
      mkdirSync(testConfigDir, { recursive: true });
      writeFileSync(
        configFile,
        JSON.stringify({ appUrl: 'https://config.example.com' })
      );

      const url = configStore.getAppUrl();
      expect(url).toBe('https://env.example.com');
    });
  });

  describe('getApiUrl', () => {
    it('should derive API URL from app URL by appending /api', () => {
      const apiUrl = configStore.getApiUrl();
      expect(apiUrl).toBe('http://localhost:3535/api');
    });

    it('should use explicit APP_API_URL env var if provided', () => {
      process.env.APP_API_URL = 'https://api.example.com';

      const apiUrl = configStore.getApiUrl();
      expect(apiUrl).toBe('https://api.example.com');
    });

    it('should derive from APP_URL env var', () => {
      process.env.APP_URL = 'https://example.com';

      const apiUrl = configStore.getApiUrl();
      expect(apiUrl).toBe('https://example.com/api');
    });

    it('should derive from config file appUrl', () => {
      mkdirSync(testConfigDir, { recursive: true });
      writeFileSync(
        configFile,
        JSON.stringify({ appUrl: 'https://config.example.com' })
      );

      const apiUrl = configStore.getApiUrl();
      expect(apiUrl).toBe('https://config.example.com/api');
    });
  });

  describe('setAppUrl', () => {
    it('should persist URL to config file', () => {
      configStore.setAppUrl('https://newurl.com');

      const savedConfig = configStore.loadConfig();
      expect(savedConfig.appUrl).toBe('https://newurl.com');
    });

    it('should update existing config', () => {
      mkdirSync(testConfigDir, { recursive: true });
      writeFileSync(configFile, JSON.stringify({ appUrl: 'https://old.com' }));

      configStore.setAppUrl('https://new.com');

      const savedConfig = configStore.loadConfig();
      expect(savedConfig.appUrl).toBe('https://new.com');
    });
  });

  describe('clearConfig', () => {
    it('should remove appUrl from config', () => {
      mkdirSync(testConfigDir, { recursive: true});
      writeFileSync(
        configFile,
        JSON.stringify({ appUrl: 'https://example.com' })
      );

      configStore.clearConfig();

      const config = configStore.loadConfig();
      expect(config.appUrl).toBeUndefined();
    });

    it('should save empty config after clearing', () => {
      mkdirSync(testConfigDir, { recursive: true });
      writeFileSync(
        configFile,
        JSON.stringify({ appUrl: 'https://example.com' })
      );

      configStore.clearConfig();

      const savedContent = readFileSync(configFile, 'utf-8');
      expect(JSON.parse(savedContent)).toEqual({});
    });
  });

  describe('isAppUrlConfigured', () => {
    it('should return false when using default', () => {
      const isConfigured = configStore.isAppUrlConfigured();
      expect(isConfigured).toBe(false);
    });

    it('should return true when env var is set', () => {
      process.env.APP_URL = 'https://example.com';

      const isConfigured = configStore.isAppUrlConfigured();
      expect(isConfigured).toBe(true);
    });

    it('should return true when config file has appUrl', () => {
      mkdirSync(testConfigDir, { recursive: true });
      writeFileSync(
        configFile,
        JSON.stringify({ appUrl: 'https://example.com' })
      );

      const isConfigured = configStore.isAppUrlConfigured();
      expect(isConfigured).toBe(true);
    });
  });

  describe('getAppUrlSource', () => {
    it('should return "default" when nothing is configured', () => {
      const source = configStore.getAppUrlSource();
      expect(source).toBe('default');
    });

    it('should return "environment" when APP_URL env var is set', () => {
      process.env.APP_URL = 'https://example.com';

      const source = configStore.getAppUrlSource();
      expect(source).toBe('environment');
    });

    it('should return "config" when loaded from config file', () => {
      mkdirSync(testConfigDir, { recursive: true });
      writeFileSync(
        configFile,
        JSON.stringify({ appUrl: 'https://example.com' })
      );

      const source = configStore.getAppUrlSource();
      expect(source).toBe('config');
    });

    it('should prioritize environment over config', () => {
      process.env.APP_URL = 'https://env.example.com';
      mkdirSync(testConfigDir, { recursive: true });
      writeFileSync(
        configFile,
        JSON.stringify({ appUrl: 'https://config.example.com' })
      );

      const source = configStore.getAppUrlSource();
      expect(source).toBe('environment');
    });
  });
});
