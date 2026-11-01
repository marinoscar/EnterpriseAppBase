import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BaselineError, proposeMapping } from '../../src/baseline/index.js';
import { parseManifest } from '../../src/lock/index.js';
import { PACKAGE_SQL, makeBaselineWorkspace } from '../helpers/baseline.js';

const ws = makeBaselineWorkspace();
const manifest = parseManifest(readFileSync(join(ws.packageDir, 'migrations', 'manifest.json'), 'utf8'));
const packageFile = (entry: { id: string }): Buffer => Buffer.from(PACKAGE_SQL[entry.id]!);
const dirs = (record: Record<string, string>): Map<string, Buffer> => new Map(Object.entries(record).map(([k, v]) => [k, Buffer.from(v)]));

describe('proposeMapping', () => {
  it('matches identical bytes whatever the directory is called', () => {
    const matched = proposeMapping(manifest, dirs({ '20260102000000_orgs_renamed': PACKAGE_SQL['0002_add_orgs']!, '20260101000000_x': PACKAGE_SQL['0001_initial']! }), packageFile);
    expect(matched).toEqual([
      { originId: 'platform:0001_initial', localDir: '20260101000000_x', kind: 'sha256' },
      { originId: 'platform:0002_add_orgs', localDir: '20260102000000_orgs_renamed', kind: 'sha256' },
    ]);
  });

  it('falls back to comments and whitespace and records the file hash that differs', () => {
    const edited = `-- fork: renumbered issue reference #9999\n${PACKAGE_SQL['0002_add_orgs']}`;
    const [hit] = proposeMapping(manifest, dirs({ '20260102000000_add_orgs': edited }), packageFile);
    expect(hit).toMatchObject({ originId: 'platform:0002_add_orgs', kind: 'normalised' });
    expect(hit!.localSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not match SQL that really differs', () => {
    const different = PACKAGE_SQL['0002_add_orgs']!.replace('"slug"', '"slug2"');
    expect(proposeMapping(manifest, dirs({ '20260102000000_add_orgs': different }), packageFile)).toEqual([]);
  });

  it('uses an operator mapping for the rest, with or without the platform: prefix', () => {
    const rewritten = 'CREATE TABLE IF NOT EXISTS "bl_orgs" ("id" UUID NOT NULL, "slug" TEXT NOT NULL, CONSTRAINT "bl_orgs_pkey" PRIMARY KEY ("id"));\n';
    const local = dirs({ '20260102000000_orgs_by_hand': rewritten });
    for (const key of ['platform:0002_add_orgs', '0002_add_orgs']) {
      const [hit] = proposeMapping(manifest, local, packageFile, { [key]: '20260102000000_orgs_by_hand' });
      expect(hit).toMatchObject({ originId: 'platform:0002_add_orgs', localDir: '20260102000000_orgs_by_hand', kind: 'operator-map' });
      expect(hit!.localSha256).toBeDefined();
    }
  });

  it('lets the operator replace the automatic match of one entry', () => {
    // 0002's bytes sit in a directory the operator maps to 0003, which has no match of its own.
    const local = dirs({ '20260102000000_a': PACKAGE_SQL['0002_add_orgs']!, '20260103000000_b': 'ALTER TABLE "bl_orgs" ADD COLUMN "other" TEXT;\n' });
    const matched = proposeMapping(manifest, local, packageFile, { '0003_add_org_slug_index': '20260103000000_b' });
    expect(matched.map((m) => [m.originId, m.localDir, m.kind])).toEqual([
      ['platform:0002_add_orgs', '20260102000000_a', 'sha256'],
      ['platform:0003_add_org_slug_index', '20260103000000_b', 'operator-map'],
    ]);
  });

  it('rejects a map naming an unknown entry, an unknown directory, or a directory another migration holds', () => {
    const local = dirs({ '20260102000000_a': PACKAGE_SQL['0002_add_orgs']! });
    expect(() => proposeMapping(manifest, local, packageFile, { '0099_nope': '20260102000000_a' })).toThrow(/not in the package manifest/);
    expect(() => proposeMapping(manifest, local, packageFile, { '0003_add_org_slug_index': 'missing_dir' })).toThrow(/not a directory/);
    expect(() => proposeMapping(manifest, local, packageFile, { '0003_add_org_slug_index': '20260102000000_a' })).toThrow(BaselineError);
    expect(() => proposeMapping(manifest, local, packageFile, { '0003_add_org_slug_index': '20260102000000_a' })).toThrow(/already matches platform:0002_add_orgs/);
  });

  it('matches a directory to at most one migration', () => {
    const same = PACKAGE_SQL['0002_add_orgs']!;
    const matched = proposeMapping(manifest, dirs({ '20260102000000_a': same }), packageFile);
    expect(matched).toHaveLength(1);
  });
});
