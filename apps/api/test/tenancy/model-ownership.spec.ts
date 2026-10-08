// =============================================================================
// Tripwire: every Prisma model is classified, and the classification agrees
// with the schema (issue #725 PP-6.5). Mocked tier: the schema is read from the
// .prisma files; the database-side proof is rls-coverage.db.spec.ts.
// =============================================================================

import { join } from 'node:path';

import { modelOwnershipRegistry, modelsOfKind, orgColumnOf } from '@marinoscar/platform-api/core';
import { readSchemaDatamodel } from '@marinoscar/platform-api/testing';

// Fills the registry: the platform classification, then the app's own.
import '../../src/prisma/ownership';

const SCHEMA = join(__dirname, '..', '..', 'prisma', 'schema');
const datamodel = readSchemaDatamodel(SCHEMA);
const modelNames = datamodel.map((m) => m.name);

describe('model ownership vs prisma/schema/', () => {
  it('classifies every model, and only models that exist', () => {
    const registered = modelOwnershipRegistry.list().map((d) => d.model);
    expect(registered.filter((m) => !modelNames.includes(m))).toEqual([]);
    expect(modelNames.filter((m) => !registered.includes(m))).toEqual([]);
  });

  it('lists exactly the ten org models, the org-optional AuditEvent, and the user and system rest', () => {
    expect(modelsOfKind('org').map((d) => d.model).sort()).toEqual([
      'AiRun',
      'AiUsageEvent',
      'Grant',
      'Group',
      'GroupInvite',
      'GroupMember',
      'OrgCredential',
      'OrgSettings',
      'StorageObject',
      'StorageObjectChunk',
    ]);
    expect(modelsOfKind('org-optional').map((d) => d.model)).toEqual(['AuditEvent']);
    expect(modelsOfKind('user').map((d) => d.model).sort()).toEqual([
      'DeviceCode',
      'Notification',
      'NotificationDelivery',
      'PersonalAccessToken',
      'PushSubscription',
      'RefreshToken',
      'UserAiKey',
      'UserCredential',
      'UserIdentity',
      'UserSettings',
    ]);
    expect(modelsOfKind('system').map((d) => d.model)).toEqual(
      expect.arrayContaining(['Job', 'Organization', 'Membership', 'Invite', 'SystemSettings', 'DatabaseBackupRun', 'User']),
    );
  });

  it('gives each org and org-optional model its organization field, and no other model has one', () => {
    for (const model of datamodel) {
      const column = orgColumnOf(model.name);
      const field = model.fields.find((f) => f.name === (column ?? 'orgId') && f.type === 'String');

      if (column === undefined) {
        expect({ model: model.name, hasOrgId: field !== undefined }).toEqual({ model: model.name, hasOrgId: false });
      } else {
        expect({ model: model.name, hasField: field !== undefined }).toEqual({ model: model.name, hasField: true });
      }
    }
  });

  it('declares the org field required on the three NOT NULL tables and optional on usage events and audit', () => {
    const optional = (name: string): boolean => datamodel.find((m) => m.name === name)!.fields.find((f) => f.name === 'orgId')!.isOptional;

    expect(['StorageObject', 'StorageObjectChunk', 'AiRun'].map(optional)).toEqual([false, false, false]);
    expect(['AiUsageEvent', 'AuditEvent'].map(optional)).toEqual([true, true]);
  });

  it('keeps the org-owned models together: a reference between two of them is a composite key', () => {
    const chunk = datamodel.find((m) => m.name === 'StorageObjectChunk')!;
    const object = chunk.fields.find((f) => f.name === 'object')!;
    expect(object.relation?.fields).toEqual(['objectId', 'orgId']);
    expect(object.relation?.references).toEqual(['id', 'orgId']);
  });
});
