// The purge plans, computed once at bootstrap (issue #743, PP-9.1). A cycle in
// the delete order, a hint naming an unknown category or a model the schema
// lacks fails startup here, naming the models, instead of failing a user's
// purge halfway.

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { modelsOfKind, orgFieldOf, userOwnedModelRegistry } from '../core/index';
import { delegateName, hasField, orderForDeletion } from './purge/purge-planner';
import { planUserPurge, type UserPurgePlan } from './purge/user-purge';
import { USER_DATA_OPTIONS, type ResolvedUserDataModuleOptions } from './user-data.options';
import { storageObjectModelHint, userDataCategoryRegistry, userDataModelRegistry } from './user-data.registries';

/**
 * One `org` model the offboarding and the factory reset delete, in order.
 *
 * @stability experimental
 */
export interface OrgDataStep {
  /** The model. */
  readonly model: string;
  /** Its client delegate. */
  readonly delegate: string;
  /** Its organization column. */
  readonly orgField: string;
  /** What the factory reset does with it. */
  readonly factoryReset: 'delete' | 'keep';
}

/**
 * The storage-object model of the org data plan.
 *
 * @stability experimental
 */
export interface OrgStorageStep {
  /** The model. */
  readonly model: string;
  /** Its client delegate. */
  readonly delegate: string;
  /** Its organization column. */
  readonly orgField: string;
}

/**
 * The org data plan: every `org` model of the model-ownership registry except
 * the storage-object model (the media step deletes it), children first.
 *
 * @stability experimental
 */
export interface OrgDataPlan {
  /** In delete order. */
  readonly steps: readonly OrgDataStep[];
  /** The storage-object model and its organization column, when registered. */
  readonly storage?: OrgStorageStep;
}

/**
 * Builds and holds the per-user purge plan and the org data plan.
 *
 * @stability experimental
 */
@Injectable()
export class UserDataPlanService implements OnModuleInit {
  private readonly logger = new Logger(UserDataPlanService.name);
  private userPlan?: UserPurgePlan;
  private orgPlan?: OrgDataPlan;

  constructor(@Inject(USER_DATA_OPTIONS) private readonly options: ResolvedUserDataModuleOptions) {}

  /** Plans at bootstrap; throws (failing startup) when no plan exists. */
  onModuleInit(): void {
    const user = this.user();
    const org = this.org();
    this.logger.log(
      `User purge plan: ${user.steps.length} inline model(s), ${user.delegated.length} delegated, ${user.kept.length} kept; ` +
        `org data plan: ${org.steps.length} model(s)`,
    );
  }

  /** The per-user purge plan. */
  user(): UserPurgePlan {
    return (this.userPlan ??= planUserPurge({
      datamodel: this.options.datamodel(),
      owned: userOwnedModelRegistry.list(),
      hint: (model) => userDataModelRegistry.get(model),
      categories: userDataCategoryRegistry.list(),
    }));
  }

  /** The org data plan. */
  org(): OrgDataPlan {
    if (this.orgPlan) return this.orgPlan;
    const datamodel = this.options.datamodel();
    const storageModel = storageObjectModelHint()?.model;
    const models = modelsOfKind('org')
      .map((def) => def.model)
      .filter((name) => name !== storageModel && datamodel.some((entry) => entry.name === name));
    const steps = orderForDeletion(models, datamodel).map((model) => ({
      model,
      delegate: delegateName(model),
      orgField: orgFieldOf(model) ?? 'orgId',
      factoryReset: userDataModelRegistry.get(model)?.factoryReset ?? ('delete' as const),
    }));
    const storageOrgField = storageModel ? orgFieldOf(storageModel) : undefined;
    const storage =
      storageModel && storageOrgField && hasField(storageModel, storageOrgField, datamodel)
        ? { model: storageModel, delegate: delegateName(storageModel), orgField: storageOrgField }
        : undefined;
    return (this.orgPlan = { steps, ...(storage ? { storage } : {}) });
  }
}
