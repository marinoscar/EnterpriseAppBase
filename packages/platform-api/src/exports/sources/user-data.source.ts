// =============================================================================
// The `user-data` export source: "give me my data" (issue #744)
// =============================================================================
//
// Driven by the user-owned data registry (#688/#699), which every model with a
// foreign key to `User` must be in (the tripwire fails otherwise):
//
//   - `account`: the caller's own `User` row (redaction applies);
//   - then one dataset per registered model with `export: 'include'`, in
//     registry order, named after the model in snake_case: an OWNER model's
//     rows where the owner field is the user, an ACTOR-ONLY model's rows where
//     any actor field is (the audit events naming the user).
//
// Columns are the model's scalar fields minus the entry's `exportOmit` and
// minus the default redaction rule (`datamodel.ts`). Credential models are
// either `exclude` or list metadata only; the `exports.secret-egress`
// conformance case proves no secret, hash or hint reaches a file.
//
// FILE BYTES ARE NOT INCLUDED: `storage_object` is a manifest (key, name,
// size, MIME type, created). Read-only through the bypass client with an
// explicit owner filter, because the user's rows sit in every organization
// they belong to.
// =============================================================================

import { z } from 'zod';

import { userOwnedModelRegistry } from '../../core/index';
import type { ExportDatamodelModel } from '../datamodel';
import type { ExportContext, ExportSource, ExportTable } from '../export.types';
import { modelTable } from './model-table';

/**
 * The source id. PERMANENT once jobs carry it.
 *
 * @stability experimental
 */
export const USER_DATA_EXPORT_SOURCE_ID = 'user-data';

/**
 * The permission the `user-data` source requires: `user_settings:read`, which
 * every role holds, so every signed-in user may export their own data.
 *
 * @stability experimental
 */
export const USER_DATA_EXPORT_PERMISSION = 'user_settings:read';

/** The datamodel's model of that name, or `undefined` (a fork removed it). */
function modelOf(ctx: ExportContext, name: string): ExportDatamodelModel | undefined {
  return ctx.datamodel.models.find((model) => model.name === name);
}

/**
 * The datasets of one user's export, in order. Exposed for the conformance
 * suite and for an app source that wraps it.
 *
 * @param ctx - the export context (`subjectId` is the user).
 * @returns the datasets.
 *
 * @stability experimental
 */
export async function* userDataTables(ctx: ExportContext): AsyncGenerator<ExportTable> {
  const user = modelOf(ctx, 'User');
  if (user) yield modelTable(ctx, { model: user, where: { id: ctx.subjectId }, dataset: 'account', title: 'Account' });

  for (const def of userOwnedModelRegistry.list()) {
    if (def.export !== 'include') continue;
    const model = modelOf(ctx, def.model);
    if (!model) continue;
    const where =
      def.ownerField !== undefined
        ? { [def.ownerField]: ctx.subjectId }
        : { OR: (def.actorFields ?? []).map((field) => ({ [field]: ctx.subjectId })) };
    yield modelTable(ctx, { model, where, omit: def.exportOmit ?? [] });
  }
}

/**
 * The platform's `user-data` source: the caller's own rows of every
 * user-owned model the registry marks `export: 'include'`. No request
 * options.
 *
 * @stability experimental
 */
export const USER_DATA_EXPORT_SOURCE: ExportSource<Record<string, never>> = {
  id: USER_DATA_EXPORT_SOURCE_ID,
  scope: 'user',
  label: 'Your data',
  description: 'Everything this application stores about you: your account, settings, tokens (without their secrets), memberships, notifications, files list and activity.',
  permission: USER_DATA_EXPORT_PERMISSION,
  requestSchema: z.object({}).strict() as z.ZodType<Record<string, never>>,
  formats: ['json', 'csv', 'xlsx'],
  collect: (ctx) => userDataTables(ctx),
};
