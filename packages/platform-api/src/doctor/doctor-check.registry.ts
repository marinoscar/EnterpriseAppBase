// =============================================================================
// Doctor check registry (issue #634; packaged by #696)
// =============================================================================
//
// The one place that knows which checks `GET /api/admin/doctor` runs.
// `DoctorService` holds this and nothing else; it has no import of any check
// and no reason to change when a capability adds one.
//
// EXPLICIT SELF-REGISTRATION, the same mechanism and for the same reasons as
// the app's `jobs/job-handler.registry.ts` (read its header): each check is an
// `@Injectable()` in its OWNING feature module, injects this registry, and calls
// `this.registry.register(this)` from its own `onModuleInit`. "Why does the
// doctor run this check?" has a grep-able answer — one `register(this)` line —
// and a check nobody wired up is a missing line in a diff rather than a
// decorator scan that silently matched nothing.
//
// The lifecycle consequence is the one the job registry documents: every
// `onModuleInit` has run before the first HTTP request is served, so the
// doctor never races a registration. (Nothing here runs at boot.)
//
// ⚠ DUPLICATE IDS THROW, where the job registry overwrites. The difference is
// deliberate: a job `type` is a persisted contract a fork may legitimately
// shadow with its own handler, while a check id only names a line in a report.
// Two checks claiming one id is always a copy-paste mistake, and reporting one
// of them while silently dropping the other would hide exactly the check its
// author thought they had added. Failing at boot is loud and trivially fixed.
//
// Built on the generic registry primitive (the `core` slice, issue #675): an
// INSTANCE registry with the primitive's default duplicate policy (throw), kept
// in registration order, and frozen in `onApplicationBootstrap`, after every
// check's `onModuleInit` has registered it. A check that registers any later is
// a wiring mistake and fails with `FROZEN`.
// =============================================================================

import { Injectable, OnApplicationBootstrap } from '@nestjs/common';

import { Registry } from '../core/index';
import { DoctorCheck } from './doctor-check.interface';

/**
 * The checks `GET /api/admin/doctor` runs. Provided (globally) by
 * `DoctorModule.forRoot()`; a feature module's check injects it and registers
 * itself from `onModuleInit`.
 *
 * @stability stable
 */
@Injectable()
export class DoctorCheckRegistry implements OnApplicationBootstrap {
  private readonly checks = new Registry<DoctorCheck>({
    name: 'doctor-checks',
    idOf: (check) => check.id,
    describeDuplicate: (existing, incoming) =>
      `Duplicate doctor check id "${incoming.id}": ${existing.constructor.name} and ` +
      `${incoming.constructor.name} both register it. Check ids must be unique.`,
  });

  /**
   * Adds `check`. Call it from the check's own `onModuleInit`.
   *
   * @param check - the check; its `id` must be unique across the application.
   * @throws RegistryError `DUPLICATE_ID` when another check already uses its id
   *   (`Duplicate doctor check id "<id>": <A> and <B> both register it. Check ids must be unique.`),
   *   `FROZEN` after the application has bootstrapped.
   *
   * @example
   * ```ts
   * onModuleInit(): void {
   *   this.registry.register(this);
   * }
   * ```
   *
   * @extensionPoint registry
   */
  register(check: DoctorCheck): void {
    this.checks.register(check);
  }

  /** The check registered under `id`, or `undefined`. */
  get(id: string): DoctorCheck | undefined {
    return this.checks.get(id);
  }

  /** Every registered check, in registration order. */
  list(): DoctorCheck[] {
    return this.checks.list();
  }

  /** Refuses further registrations once every module's `onModuleInit` has run. */
  onApplicationBootstrap(): void {
    this.checks.freeze();
  }
}
