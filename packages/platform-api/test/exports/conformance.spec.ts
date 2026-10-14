import { registerModelOwnership, registerUserOwnedModels } from '../../src/core';
import { withTemporaryEntries } from '../../src/core/registry/testing';
import {
  BUILTIN_EXPORT_WRITERS,
  ORG_DATA_EXPORT_SOURCE,
  USER_DATA_EXPORT_SOURCE,
  exportSourceRegistry,
  registerExportSource,
  registerExportWriter,
} from '../../src/exports';
import {
  checkExportRegistries,
  collectExportOutput,
  exportsConformanceSuite,
  sentinelExportDb,
  forbiddenExportSentinels,
  runSentinelExports,
} from '../../src/exports/testing';
import { conformanceSuites } from '../../src/testing';
import { FIXTURE_DATAMODEL } from './support';

for (const writer of BUILTIN_EXPORT_WRITERS) registerExportWriter(writer);
registerExportSource(USER_DATA_EXPORT_SOURCE);
registerExportSource(ORG_DATA_EXPORT_SOURCE);
registerUserOwnedModels([
  { model: 'ApiToken', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'tokens' },
  { model: 'Diary', ownerField: 'userId', purge: 'delete', export: 'include', exportOmit: ['private'], rationale: 'diary' },
  { model: 'Session', ownerField: 'userId', purge: 'delete', export: 'exclude', rationale: 'session' },
  { model: 'Membership', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'membership' },
  { model: 'Organization', actorFields: ['id'], purge: 'detach', export: 'exclude', rationale: 'org' },
]);
registerModelOwnership([
  { model: 'Folder', kind: 'org', rationale: 'folder' },
  { model: 'Vault', kind: 'org', rationale: 'vault' },
]);

const PERMISSIONS = [{ id: 'user_settings:read' }, { id: 'org_members:read' }, { id: 'organizations:read' }];

describe('the exports conformance suite', () => {
  it('registers itself', () => {
    expect(conformanceSuites.has(exportsConformanceSuite.id)).toBe(true);
  });

  it('finds nothing wrong with a conforming app', () => {
    expect(checkExportRegistries({ datamodel: FIXTURE_DATAMODEL, permissions: PERMISSIONS })).toEqual([]);
  });

  it('names an unregistered permission and an exportOmit field that does not exist', async () => {
    expect(checkExportRegistries({ datamodel: FIXTURE_DATAMODEL, permissions: [] }).map((f) => f.file)).toEqual([
      'source:user-data',
      'source:org-data',
      'source:org-data',
    ]);
    await withTemporaryEntries(exportSourceRegistry, [{ ...USER_DATA_EXPORT_SOURCE, id: 'no-writer', formats: ['pdf'] }], () => {
      expect(checkExportRegistries({ datamodel: FIXTURE_DATAMODEL, permissions: PERMISSIONS })).toEqual([
        { file: 'source:no-writer', message: 'offers no registered writer' },
      ]);
    });
  });

  it('secret-egress: no forbidden sentinel in any output of either source, with every writer', async () => {
    const outputs = await runSentinelExports({ datamodel: FIXTURE_DATAMODEL, permissions: PERMISSIONS });
    expect(outputs.map((o) => `${o.source}/${o.format}`)).toEqual([
      'user-data/json',
      'user-data/csv',
      'user-data/xlsx',
      'org-data/json',
      'org-data/csv',
      'org-data/xlsx',
    ]);
    for (const output of outputs) {
      const forbidden = forbiddenExportSentinels(FIXTURE_DATAMODEL, output.source);
      expect(forbidden).toEqual(expect.arrayContaining(['S3NT1N3L-ApiToken-tokenHash-Z', 'S3NT1N3L-Diary-blob-Z', 'S3NT1N3L-Vault-secret-Z']));
      expect(forbidden.filter((sentinel) => output.text.includes(sentinel))).toEqual([]);
    }
    expect(outputs[0]!.text).toContain('S3NT1N3L-ApiToken-name-Z');
    expect(outputs[3]!.text).toContain('S3NT1N3L-Folder-title-Z');
    expect(outputs[3]!.text).not.toContain('S3NT1N3L-Folder-linkTokenCiphertext-Z');
  });

  it('a writer that dumps whole rows still cannot leak: redaction happens before any writer', async () => {
    const leaky = {
      ...BUILTIN_EXPORT_WRITERS[0]!,
      id: 'leaky',
      async write(tables: AsyncIterable<{ dataset: string; rows: AsyncIterable<unknown> }>, out: NodeJS.WritableStream) {
        for await (const table of tables) for await (const row of table.rows) out.write(JSON.stringify(row));
        out.end();
        return { rowCounts: {} };
      },
    };
    // The leaky writer sees only the selected columns, so it cannot leak: the
    // proof the redaction happens before any writer is involved.
    const ctx = {
      exportId: 'x',
      scope: 'user' as const,
      subjectId: 'u',
      requestedById: 'u',
      db: sentinelExportDb(FIXTURE_DATAMODEL),
      datamodel: FIXTURE_DATAMODEL,
      pageSize: 10,
      now: new Date(),
    };
    const { bytes } = await collectExportOutput(leaky as never, USER_DATA_EXPORT_SOURCE.collect(ctx, {}));
    expect(bytes.toString('utf8')).not.toContain('tokenHash');
  });
});
