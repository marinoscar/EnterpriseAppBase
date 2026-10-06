// =============================================================================
// Tripwire: every User foreign key is registered, and policies match onDelete
// (issue #688, PP-1.9)
// =============================================================================
//
// Fails when:
//   - a model gains a relation to `User` without a user-owned registry entry;
//   - an entry names a model, field or exportOmit column that does not exist,
//     or a field that is not a foreign key to `User`;
//   - an entry's purge policy contradicts the relation's `onDelete`
//     ('delete' ⇔ Cascade, 'detach' ⇔ SetNull, 'retain' ⇔ Restrict/NoAction).
//
// The fix is always an entry in
// apps/api/src/prisma/ownership/platform-user-owned-models.ts (platform) or
// apps/api/src/app-registrations/user-owned-models.ts (app); see
// apps/api/src/prisma/ownership/README.md.
//
// Mocked tier: no database. The schema is read from prisma/schema.prisma
// (schema-datamodel.ts says why not from the generated client).
// =============================================================================

import { userOwnedModelRegistry, type UserOwnedModelDef } from '../../src/prisma/ownership';
import type { DatamodelField, DatamodelModel } from './schema-datamodel';
import { readSchemaDatamodel } from './schema-datamodel';
import { checkUserOwnedModels } from './user-owned-models.check';

// -----------------------------------------------------------------------------
// The real schema
// -----------------------------------------------------------------------------

describe('user-owned model registry vs prisma/schema.prisma', () => {
  const datamodel = readSchemaDatamodel();
  const defs = userOwnedModelRegistry.list();

  it('registers every User foreign key with policies that match onDelete', () => {
    expect(checkUserOwnedModels(datamodel, defs)).toEqual([]);
  });

  it('covers 23 models and 25 User foreign keys', () => {
    const withUserKeys = datamodel.filter((model) =>
      model.fields.some((field) => field.type === 'User' && (field.relation?.fields.length ?? 0) > 0),
    );
    expect(withUserKeys).toHaveLength(23);
    expect(new Set(defs.map((def) => def.model))).toEqual(new Set(withUserKeys.map((model) => model.name)));
  });
});

// -----------------------------------------------------------------------------
// The checker, against synthetic datamodels: each rule fires
// -----------------------------------------------------------------------------

const id: DatamodelField = { name: 'id', type: 'String', isList: false, isOptional: false };
const scalar = (name: string, isOptional = false): DatamodelField => ({ name, type: 'String', isList: false, isOptional });
const userRelation = (name: string, fk: string, onDelete?: string, isOptional = false): DatamodelField => ({
  name,
  type: 'User',
  isList: false,
  isOptional,
  relation: { fields: [fk], references: ['id'], ...(onDelete ? { onDelete } : {}) },
});

const user: DatamodelModel = { name: 'User', fields: [id] };
const note: DatamodelModel = {
  name: 'Note',
  fields: [id, scalar('userId'), scalar('body'), userRelation('user', 'userId', 'Cascade')],
};
const log: DatamodelModel = {
  name: 'Log',
  fields: [id, scalar('actorId', true), scalar('reviewerId', true), userRelation('actor', 'actorId', 'SetNull', true), userRelation('reviewer', 'reviewerId', undefined, true)],
};

const noteDef = { model: 'Note', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'x' } as unknown as UserOwnedModelDef;
const logDef = { model: 'Log', actorFields: ['actorId', 'reviewerId'], purge: 'detach', export: 'exclude', rationale: 'x' } as unknown as UserOwnedModelDef;
const def = (overrides: Record<string, unknown>, base = noteDef) => ({ ...base, ...overrides }) as unknown as UserOwnedModelDef;

describe('checkUserOwnedModels', () => {
  const datamodel = [user, note, log];

  it('passes a consistent registry (including Prisma default onDelete for an optional relation)', () => {
    expect(checkUserOwnedModels(datamodel, [noteDef, logDef])).toEqual([]);
  });

  it('fails when a model with a User relation is not registered, naming the fix', () => {
    const problems = checkUserOwnedModels(datamodel, [logDef]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Note.userId is a foreign key to User with no registry entry');
    expect(problems[0]).toContain(
      'Register Note.userId in apps/api/src/prisma/ownership/platform-user-owned-models.ts (platform) or apps/api/src/app-registrations/user-owned-models.ts (app), with a purge and export policy.',
    );
  });

  it('fails when a registered model gains a second User relation', () => {
    const grown: DatamodelModel = {
      ...note,
      fields: [...note.fields, scalar('editorId', true), userRelation('editor', 'editorId', 'SetNull', true)],
    };
    expect(checkUserOwnedModels([user, grown, log], [noteDef, logDef])).toEqual([
      expect.stringContaining('Note.editorId is a foreign key to User with no registry entry'),
    ]);
  });

  it('fails when a registered model does not exist', () => {
    expect(checkUserOwnedModels(datamodel, [noteDef, logDef, def({ model: 'Ghost' })])).toEqual([
      'Ghost is registered but schema.prisma has no such model. Remove or rename the entry.',
    ]);
  });

  it('fails when a registered field does not exist', () => {
    const problems = checkUserOwnedModels(datamodel, [noteDef, def({ actorFields: ['actorId', 'reviewerId', 'gone'] }, logDef)]);
    expect(problems).toEqual(['Log.gone is registered as the actor field but schema.prisma has no such column.']);
  });

  it('fails when a registered field is not a foreign key to User', () => {
    const problems = checkUserOwnedModels(datamodel, [def({ ownerField: 'body' }), logDef]);
    expect(problems).toEqual(
      expect.arrayContaining([
        'Note.body is registered as the owner field but is not a foreign key to User.',
        expect.stringContaining('Note.userId is a foreign key to User with no registry entry'),
      ]),
    );
  });

  it("fails when purge 'detach' contradicts onDelete Cascade, naming model, field and both values", () => {
    expect(checkUserOwnedModels(datamodel, [def({ purge: 'detach' }), logDef])).toEqual([
      "Note.userId: purge 'detach' requires onDelete SetNull, but schema.prisma has Cascade (relation user).",
    ]);
  });

  it("fails when purge 'delete' contradicts onDelete SetNull on an actor field", () => {
    expect(checkUserOwnedModels(datamodel, [noteDef, def({ purge: 'delete' }, logDef)])).toEqual([
      "Log.actorId: purge 'delete' requires onDelete Cascade, but schema.prisma has SetNull (relation actor).",
      "Log.reviewerId: purge 'delete' requires onDelete Cascade, but schema.prisma has SetNull (relation reviewer).",
    ]);
  });

  it("fails when purge 'retain' meets a relation that cascades or nulls", () => {
    expect(checkUserOwnedModels(datamodel, [noteDef, def({ purge: 'retain' }, logDef)])).toHaveLength(2);
  });

  it("treats a required relation without onDelete as Restrict", () => {
    const strict: DatamodelModel = { ...note, fields: [id, scalar('userId'), userRelation('user', 'userId')] };
    expect(checkUserOwnedModels([user, strict, log], [noteDef, logDef])).toEqual([
      "Note.userId: purge 'delete' requires onDelete Cascade, but schema.prisma has Restrict (relation user).",
    ]);
  });

  it('fails when the owner relation is not where ownerRelation (or its default) points', () => {
    const renamed: DatamodelModel = { ...note, fields: [id, scalar('userId'), userRelation('owner', 'userId', 'Cascade')] };
    expect(checkUserOwnedModels([user, renamed, log], [noteDef, logDef])).toEqual([
      'Note.userId: the owner relation field is "owner", not "user". Set ownerRelation: \'owner\'.',
    ]);
    expect(checkUserOwnedModels([user, renamed, log], [def({ ownerRelation: 'owner' }), logDef])).toEqual([]);
  });

  it('fails when an actor field on an owned model cascades', () => {
    const mixed: DatamodelModel = {
      ...note,
      fields: [...note.fields, scalar('editorId'), userRelation('editor', 'editorId', 'Cascade')],
    };
    expect(checkUserOwnedModels([user, mixed, log], [def({ actorFields: ['editorId'] }), logDef])).toEqual([
      'Note.editorId: an actor field on an owned model cannot be onDelete Cascade: deleting the actor would delete a row another user owns.',
    ]);
  });

  it('fails when exportOmit names a missing column', () => {
    expect(checkUserOwnedModels(datamodel, [def({ exportOmit: ['body', 'secret'] }), logDef])).toEqual([
      'Note.exportOmit names "secret", which schema.prisma does not have.',
    ]);
  });
});
