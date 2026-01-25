import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

/**
 * Application configuration
 * Only stores appUrl - apiUrl is derived by appending /api
 */
export interface AppConfig {
  appUrl?: string;
}

const DEFAULT_APP_URL = 'http://localhost:3535';

/**
 * Get the config directory path
 */
function getConfigDir(): string {
  return process.env.APP_CONFIG_DIR || join(homedir(), '.config', 'app');
}

/**
 * Get the config file path
 */
function getConfigFile(): string {
  return join(getConfigDir(), 'config.json');
}

/**
 * Load configuration from file
 */
export function loadConfig(): AppConfig {
  try {
    const configFile = getConfigFile();
    if (!existsSync(configFile)) {
      return {};
    }

    const content = readFileSync(configFile, 'utf-8');
    return JSON.parse(content) as AppConfig;
  } catch {
    return {};
  }
}

/**
 * Save configuration to file
 */
export function saveConfig(config: AppConfig): void {
  const configFile = getConfigFile();
  const dir = dirname(configFile);

  // Create config directory if it doesn't exist
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Write config with restricted permissions (owner read/write only)
  writeFileSync(configFile, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

/**
 * Get the App URL with priority: env var > persisted config > default
 */
export function getAppUrl(): string {
  // Environment variable takes precedence
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }

  // Check persisted config
  const config = loadConfig();
  if (config.appUrl) {
    return config.appUrl;
  }

  // Default
  return DEFAULT_APP_URL;
}

/**
 * Get the API URL (derived from App URL by appending /api)
 * Priority: env var APP_API_URL > derived from APP_URL > default
 */
export function getApiUrl(): string {
  // Explicit API URL env var takes precedence
  if (process.env.APP_API_URL) {
    return process.env.APP_API_URL;
  }

  // Derive from app URL
  return `${getAppUrl()}/api`;
}

/**
 * Set the App URL in config
 */
export function setAppUrl(url: string): void {
  const config = loadConfig();
  config.appUrl = url;
  saveConfig(config);
}

/**
 * Clear the config (revert to default)
 */
export function clearConfig(): void {
  const config = loadConfig();
  delete config.appUrl;
  saveConfig(config);
}

/**
 * Check if App URL is configured (not using default)
 */
export function isAppUrlConfigured(): boolean {
  if (process.env.APP_URL) {
    return true;
  }

  const config = loadConfig();
  return !!config.appUrl;
}

/**
 * Get the source of the current App URL configuration
 */
export function getAppUrlSource(): 'environment' | 'config' | 'default' {
  if (process.env.APP_URL) {
    return 'environment';
  }

  const config = loadConfig();
  if (config.appUrl) {
    return 'config';
  }

  return 'default';
}
