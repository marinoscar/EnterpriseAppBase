// =============================================================================
// The `user-data.registries` Doctor check (issue #880)
// =============================================================================
//
// The reset registries are the one place an app decides what a user's deletion,
// the factory reset and an export reach. The `user-data` conformance suite
// proves them in the app's CI; this check proves them on the RUNNING
// deployment, with the same three pure checks: every owner model has a keep or
// delete decision in a registered category, every hint and scope names what
// exists, and a delete order exists. Read-only and I/O-free (the registries and
// the already-parsed schema are in memory).
// =============================================================================

import { Inject, Injectable, OnModuleInit } from '@nestjs/common';

import { userOwnedModelRegistry } from '../../core/index';
import { DoctorCheckRegistry, type DoctorCheck, type DoctorCheckOutcome } from '../../doctor/index';
import { checkUserDataDecisions, checkUserDataHints, checkUserDataPlan } from '../registry-checks';
import { USER_DATA_OPTIONS, type ResolvedUserDataModuleOptions } from '../user-data.options';
import { resolvedUserDataScopes, userDataCategoryRegistry, userDataModelRegistry } from '../user-data.registries';

/** How many findings the detail line quotes before it says "and N more". */
const QUOTED_FINDINGS = 3;

/**
 * `user-data` / `user-data.registries`: the reset registries agree with the
 * schema. `pass` when every check is clean; `fail` with the findings (a
 * deletion would silently skip an undecided model, or no delete order exists).
 *
 * @stability experimental
 */
@Injectable()
export class UserDataRegistriesDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'user-data.registries';
  readonly category = 'user-data';
  readonly label = 'Data reset registries';

  constructor(
    private readonly registry: DoctorCheckRegistry,
    @Inject(USER_DATA_OPTIONS) private readonly options: ResolvedUserDataModuleOptions,
  ) {}

  /** Registers the check with the Doctor. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Read-only: the three registry checks over the parsed schema. Never throws. */
  async run(): Promise<DoctorCheckOutcome> {
    let findings;
    try {
      const datamodel = this.options.datamodel();
      findings = [...checkUserDataDecisions(), ...checkUserDataHints(datamodel), ...checkUserDataPlan(datamodel)];
    } catch (error) {
      return {
        status: 'fail',
        detail: 'The schema the reset registries are checked against could not be read',
        remedy: 'Ship the composed Prisma schema folder (prisma/schema) with the API image: UserDataModule.forRoot({ datamodel }) reads it.',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const data = {
      ownerModels: userOwnedModelRegistry.list().filter((def) => def.ownerField !== undefined).length,
      hints: userDataModelRegistry.list().length,
      categories: userDataCategoryRegistry.ids().length,
      scopes: resolvedUserDataScopes().length,
    };

    if (findings.length === 0) {
      return {
        status: 'pass',
        detail: `${data.ownerModels} owner model(s) decided across ${data.categories} categories and ${data.scopes} scopes; a delete order exists`,
        data,
      };
    }

    const quoted = findings.slice(0, QUOTED_FINDINGS).map((finding) => finding.message);
    const more = findings.length > QUOTED_FINDINGS ? ` (and ${findings.length - QUOTED_FINDINGS} more)` : '';
    return {
      status: 'fail',
      detail: `${findings.length} problem(s) in the data reset registries: ${quoted.join('; ')}${more}`,
      remedy:
        "Fix the app's user-data manifest (registerUserDataModels, registerUserDataCategory, registerUserDataScope) so every owner model " +
        'is kept with a reason or deleted in a registered category, then restart. docs/specs/user-data-reset.md §4 lists the steps.',
      data: { ...data, findings: findings.length },
    };
  }
}
