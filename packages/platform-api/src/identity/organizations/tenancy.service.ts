import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  parseTenancyMode,
  tenancyCapabilitiesFor,
  type TenancyCapabilities,
  type TenancyMode,
} from './tenancy-mode';
import { recordTenancyMode } from '../auth/tenancy-mode';

/**
 * The deployment's tenancy mode (`TENANCY_MODE`, PP-6.2, #722) and what it does
 * at sign-in.
 *
 * Parsed ONCE, in the constructor, from `tenancy.mode`, which
 * `configuration.ts` already produced through the same pure `parseTenancyMode`
 * (an invalid value never gets this far). Parsing again is idempotent and
 * keeps a test module whose `ConfigService` stub knows nothing about tenancy
 * on the default, `single`.
 *
 * Read-only for the life of the process: the mode is a fact about the
 * deployment, changed by its operator and a restart, never at runtime.
 */
@Injectable()
export class TenancyService {
  private readonly current: TenancyMode;

  readonly capabilities: Readonly<TenancyCapabilities>;

  constructor(config: ConfigService) {
    this.current = parseTenancyMode(config.get<string>('tenancy.mode'));
    this.capabilities = Object.freeze(tenancyCapabilitiesFor(this.current));
    // PP-6.3 (#723): the guards' principal factory reads the mode without DI.
    recordTenancyMode(this.current);
  }

  /** `'single'` or `'multi'`. */
  mode(): TenancyMode {
    return this.current;
  }

  /** True in single-org mode (everyone auto-joins the default organization). */
  isSingle(): boolean {
    return this.current === 'single';
  }

  /**
   * Whether this sign-in must be ensured a default-org membership.
   *
   * Always in `single`. In `multi`, only for the `INITIAL_ADMIN_EMAIL` account,
   * so a fresh multi-org deployment can still be administered.
   */
  autoJoinsDefaultOrg(isInitialAdmin: boolean): boolean {
    return this.capabilities.autoJoinDefaultOrg || isInitialAdmin;
  }
}
