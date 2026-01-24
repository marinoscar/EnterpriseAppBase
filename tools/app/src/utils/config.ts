import { homedir } from 'os';
import { join } from 'path';
import { getApiUrl, getAppUrl } from '../lib/config-store.js';

/**
 * CLI Configuration
 */
export const config = {
  /**
   * API base URL (without trailing slash)
   * Priority: environment variable > persisted config > default
   */
  get apiUrl(): string {
    return getApiUrl();
  },

  /**
   * Application URL (for device auth redirect)
   * Priority: environment variable > persisted config > default
   */
  get appUrl(): string {
    return getAppUrl();
  },

  /**
   * Config directory for storing auth tokens
   */
  get configDir(): string {
    return process.env.APP_CONFIG_DIR || join(homedir(), '.config', 'app');
  },

  /**
   * Auth file path
   */
  get authFile(): string {
    return join(this.configDir, 'auth.json');
  },

  /**
   * Config file path (for persisted settings)
   */
  get configFile(): string {
    return join(this.configDir, 'config.json');
  },

  /**
   * Docker container name for API
   */
  containerName: 'compose-api-1',

  /**
   * Default polling interval for device auth (seconds)
   */
  deviceAuthPollInterval: 5,

  /**
   * Whether to include emojis in output (can be disabled for non-unicode terminals)
   */
  get useEmoji(): boolean {
    return process.env.APP_NO_EMOJI !== '1';
  },
};

/**
 * Get icon based on emoji setting
 */
export function getIcon(emoji: string, fallback: string = ''): string {
  return config.useEmoji ? emoji : fallback;
}
