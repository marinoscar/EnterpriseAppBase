import { Injectable, OnModuleInit } from '@nestjs/common';

import { assertEncryptionKeyConfigured } from '../../core/index';
import { DoctorCheckRegistry, type DoctorCheck, type DoctorCheckOutcome } from '../../doctor/index';

/**
 * `core` / `secrets.encryption-key` — `SECRETS_ENCRYPTION_KEY` is present and
 * well-formed.
 *
 * Calls the same assertion bootstrap uses. Its error message describes the
 * key's SHAPE only ("is not set", "decoded to 24 bytes") and never any of its
 * bytes — `secret-cipher.ts` guarantees that — so it is safe to report.
 *
 * @stability experimental
 */
@Injectable()
export class EncryptionKeyDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'secrets.encryption-key';
  readonly category = 'core';
  readonly label = 'Secrets encryption key';

  /** Overridable in tests: the key is cached per process. */
  protected assertKey: () => void = assertEncryptionKeyConfigured;

  constructor(private readonly registry: DoctorCheckRegistry) {}

  /** Registers the check with the Doctor. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    try {
      this.assertKey();

      return { status: 'pass', detail: 'SECRETS_ENCRYPTION_KEY is set and is a valid 32-byte key' };
    } catch (error) {
      return {
        status: 'fail',
        detail: 'SECRETS_ENCRYPTION_KEY is missing or malformed; stored credentials cannot be read or saved',
        remedy:
          'Set SECRETS_ENCRYPTION_KEY to the output of `openssl rand -base64 32` and restart the API. ' +
          'If credentials were already saved, restore the ORIGINAL key instead — a new key cannot decrypt them.',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
