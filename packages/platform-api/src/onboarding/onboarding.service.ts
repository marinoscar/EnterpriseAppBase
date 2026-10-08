// =============================================================================
// OnboardingService: the caller's derived checklists (issue #745, PP-9.3)
// =============================================================================
//
// READ-ONLY. The stored UI state is read straight from `user_settings`
// through `ONBOARDING_DATA.readUserSettingsValue` (a select), never through
// `UserSettingsService.getSettings`, which creates a default row on first
// read: a GET leaves the database unchanged for a user with no settings row.
// Step status is derived by the engine on every request and never stored.
//
// The admin steps reuse the Doctor (its cache, its timeouts, its remedies):
// one `DoctorService.run` per Doctor category the applicable steps' checks
// span, with `refresh` forwarded.
// =============================================================================

import type { DoctorCheckReport } from '@marinoscar/platform-contract/doctor';
import type { OnboardingResponse } from '@marinoscar/platform-contract/onboarding';
import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';

import { DoctorCheckRegistry, DoctorService } from '../doctor/index';
import { ONBOARDING_FACTS } from './onboarding.builtins';
import { evaluateOnboarding } from './onboarding.engine';
import { DEFAULT_ONBOARDING_OPTIONS, ONBOARDING_OPTIONS, type ResolvedOnboardingModuleOptions } from './onboarding.options';
import {
  assertOnboardingRegistries,
  onboardingFactRegistry,
  onboardingOrderingRegistry,
  onboardingStepRegistry,
} from './onboarding.registries';
import { readOnboardingState } from './onboarding.settings';
import type { OnboardingCaller, OnboardingDoctorAccess, OnboardingRequestContext } from './onboarding.types';
import { ONBOARDING_DATA, ONBOARDING_FEATURES, type OnboardingDataPort, type OnboardingFeatureGate } from './ports';

/**
 * Who `GET /api/onboarding` is for: the request user.
 *
 * @stability experimental
 */
export interface OnboardingServiceCaller {
  /** The user's id. */
  id: string;
  /** Effective permissions. */
  permissions: readonly string[];
  /** Role names. */
  roles?: readonly string[];
  /** The active organization. */
  activeOrgId?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Derives `GET /api/onboarding`. Provided by `OnboardingModule.forRoot()`.
 *
 * @stability experimental
 */
@Injectable()
export class OnboardingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OnboardingService.name);
  private readonly options: ResolvedOnboardingModuleOptions;

  /**
   * @param data - the app's data port.
   * @param moduleRef - for app facts (`ctx.get(token)`).
   * @param features - the feature gate; absent: every feature-gated step is omitted.
   * @param doctor - the Doctor; absent: every Doctor-backed step is omitted.
   * @param checks - the Doctor's check registry.
   * @param config - reads `INITIAL_ADMIN_EMAIL`.
   * @param options - the resolved module options.
   */
  constructor(
    @Inject(ONBOARDING_DATA) private readonly data: OnboardingDataPort,
    private readonly moduleRef: ModuleRef,
    @Optional() @Inject(ONBOARDING_FEATURES) private readonly features?: OnboardingFeatureGate,
    @Optional() @Inject(DoctorService) private readonly doctor?: DoctorService,
    @Optional() @Inject(DoctorCheckRegistry) private readonly checks?: DoctorCheckRegistry,
    @Optional() @Inject(ConfigService) private readonly config?: ConfigService,
    @Optional() @Inject(ONBOARDING_OPTIONS) options?: ResolvedOnboardingModuleOptions,
  ) {
    this.options = options ?? DEFAULT_ONBOARDING_OPTIONS;
  }

  /** Fails the boot when a step or an ordering names an unregistered fact. */
  onApplicationBootstrap(): void {
    assertOnboardingRegistries();
  }

  /**
   * The caller's stored UI state, user block and (for an administrator)
   * admin block.
   *
   * @param caller - the request user.
   * @param options - `refresh` bypasses the Doctor's cache.
   * @returns the response.
   */
  async get(caller: OnboardingServiceCaller, options: { refresh?: boolean } = {}): Promise<OnboardingResponse> {
    const value = asRecord(await this.data.readUserSettingsValue(caller.id));
    const settings = readOnboardingState(value);
    const refresh = options.refresh === true;
    const who: OnboardingCaller = {
      id: caller.id,
      permissions: [...caller.permissions],
      roles: [...(caller.roles ?? [])],
      activeOrgId: caller.activeOrgId ?? null,
    };

    const featureMemo = new Map<string, Promise<boolean>>();
    const isFeatureEnabled = (feature: string): Promise<boolean> => {
      let pending = featureMemo.get(feature);
      if (!pending) {
        pending = this.features ? this.features.isEnabled(feature).catch(() => false) : Promise.resolve(false);
        featureMemo.set(feature, pending);
      }
      return pending;
    };
    const initialAdminEmail = this.config?.get<string>(this.options.initialAdminEmailEnv)?.trim() || null;
    const doctor = this.doctorAccess();

    const { user, admin } = await evaluateOnboarding({
      steps: onboardingStepRegistry.list(),
      facts: onboardingFactRegistry.list(),
      orderings: onboardingOrderingRegistry.list(),
      includeAdmin: who.permissions.includes(this.options.adminPermission),
      skipped: settings.skipped,
      seed: new Map([[ONBOARDING_FACTS.USER_SETTINGS, value]]),
      warn: (message) => this.logger.warn(message),
      context: (doctorCheckIds, fact): OnboardingRequestContext => ({
        caller: who,
        refresh,
        data: this.data,
        doctor,
        doctorCheckIds,
        initialAdminEmail,
        isFeatureEnabled,
        fact: <T>(id: string) => fact(id) as Promise<T>,
        get: <T>(token: unknown) => this.moduleRef.get(token as never, { strict: false }) as T,
      }),
    });

    return { settings, user, admin };
  }

  private doctorAccess(): OnboardingDoctorAccess | null {
    const doctor = this.doctor;
    const checks = this.checks;
    if (!doctor || !checks) return null;

    return {
      has: (id) => checks.get(id) !== undefined,
      reports: async (ids, refresh) => {
        const categories = [...new Set(ids.map((id) => checks.get(id)?.category).filter((c): c is string => !!c))];
        const reports = await Promise.all(categories.map((category) => doctor.run({ category, refresh })));
        const byId = new Map<string, DoctorCheckReport>();
        for (const report of reports) for (const check of report.checks) byId.set(check.id, check);
        return byId;
      },
    };
  }
}
