import { homedir } from 'os';
import { join } from 'path';

/**
 * CLI Configuration
 */
export const config = {
  /**
   * API base URL (without trailing slash)
   */
  get apiUrl(): string {
    return process.env.APP_API_URL || 'http://localhost:3535/api';
  },

  /**
   * Application URL (for device auth redirect)
   */
  get appUrl(): string {
    return process.env.APP_URL || 'http://localhost:3535';
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
