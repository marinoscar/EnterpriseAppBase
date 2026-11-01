// =============================================================================
// StorageSubmissionService — a submitted, UNSAVED configuration, made runnable (#375; PP-14.7)
// =============================================================================
//
// `POST /test` and `POST /bucket` both take the configuration in the request
// body, which does not have to have been saved, and both need the same thing
// before they can call the driver: the driver, its settings (the stored ones,
// the legacy flat aliases, then `drivers.<id>`), a way to resolve its secrets
// (a typed value wins, a blank one means "use the stored one") and the context
// every driver operation receives. This is that, once, so the two routes
// cannot disagree about what "the submitted configuration" is.
//
// ⚠ THE SECRET, AND WHERE IT IS ALLOWED TO GO. A secret is read at the moment a
// driver asks for it (`ctx.secret(name)`), held in a local map for the length of
// the call so it can be REDACTED out of anything that is about to be shown to an
// administrator, and never stored, logged or returned. A driver that never asks
// for a secret never causes one to be decrypted.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CredentialsService } from '../../credentials/index';
import { SystemSettingsService } from '../../settings/index';
import {
  getStorageDriver,
  storageLocationOf,
  storageSecretAddress,
  type StorageDriverContext,
  type StorageDriverDefinition,
  type StorageDriverLocation,
} from '../drivers/storage-driver';
import { storageDriverContext } from './storage-driver-context';
import {
  submittedDriverSettings,
  submittedSecretValues,
  unknownDriverRejection,
} from './storage-settings-compat';
// The built-in drivers register on import: whatever resolves a driver by id finds them.
import '../drivers/builtin-storage-drivers';

/**
 * A submitted configuration, ready to hand to a driver.
 *
 * @stability experimental
 */
export interface PreparedStorageSubmission {
  /** The driver the body names. */
  driver: StorageDriverDefinition<any>;
  /** Its settings: stored, then aliases, then `drivers.<id>`, parsed by the driver. */
  settings: Record<string, unknown>;
  /** The context to call the driver with. */
  ctx: StorageDriverContext;
  /** Where the settings point. */
  location: StorageDriverLocation;
  /** Whether a declared secret was left blank, so the stored one was used. */
  usedStoredSecret: boolean;
  /** Replaces every secret value this call has resolved (so far) in `text` with `[redacted]`. */
  redact(text: string): string;
}

/**
 * Resolves the driver, settings and secrets of a SUBMITTED, unsaved storage configuration (the body of `POST /test` and `POST /bucket`), so the two routes cannot disagree about what that configuration is.
 *
 * @stability experimental
 */
@Injectable()
export class StorageSubmissionService {
  private readonly logger = new Logger(StorageSubmissionService.name);

  constructor(
    private readonly credentials: CredentialsService,
    private readonly systemSettings: SystemSettingsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Resolves the body's driver, settings and secrets.
   *
   * @param input - the request body of `POST /test` or `POST /bucket`.
   * @throws BadRequestException (400) for an unregistered driver, settings the driver refuses, or an alias contradicting `drivers`.
   */
  async prepare(input: { provider: string } & Record<string, unknown>): Promise<PreparedStorageSubmission> {
    const driver = getStorageDriver(input.provider) ?? unknownDriverRejection(input.provider);
    const stored = (await this.systemSettings.getStoragePolicy()).drivers[driver.id];
    const settings = submittedDriverSettings(driver.id, stored, input);
    const typed = submittedSecretValues(driver.id, input);
    const resolved = new Map<string, string>();

    // BLANK PRESERVES, exactly as on `PUT`. An admin who changed only the region
    // must not have to re-paste a credential they may not have to hand.
    const secret = async (name: string): Promise<string | null> => {
      const value =
        typed[name] ??
        (await this.credentials.getSecret(storageSecretAddress(driver, name).purpose, storageSecretAddress(driver, name).name));
      if (value) resolved.set(name, value);
      return value ?? null;
    };

    return {
      driver,
      settings,
      ctx: storageDriverContext({ settings, secret, logger: this.logger, config: this.config }),
      location: storageLocationOf(driver, settings),
      usedStoredSecret: (driver.secrets ?? []).some((spec) => typed[spec.name] === undefined),
      redact: (text) => {
        let out = text;
        for (const value of [...Object.values(typed), ...resolved.values()]) {
          if (value.length === 0 || !out.includes(value)) continue;
          out = value.length < 4 ? '[withheld: it contained a configured secret]' : out.split(value).join('[redacted]');
        }
        return out;
      },
    };
  }
}
