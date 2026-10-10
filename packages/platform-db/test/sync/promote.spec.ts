import { describe, expect, it } from 'vitest';
import { emptyLock, sha256Hex, type PlatformLock } from '../../src/lock/index.js';
import { promote, SyncError, type PromoteIo } from '../../src/sync/index.js';
import { fixtureManifest } from '../helpers/fixtures.js';

const BYTES = Buffer.from('-- CreateTable\nCREATE TABLE "orgs_members" ("id" UUID NOT NULL);\n');

function syncedLock(): PlatformLock {
  const manifest = fixtureManifest();
  return {
    lockVersion: 1,
    platformVersion: '0.1.0',
    migrations: manifest.map((m, i) => ({
      originId: `platform:${m.id}`,
      localDir: `2026010${i + 1}000000_${m.id.slice(5)}`,
      sha256: m.sha256,
      since: m.since,
    })),
  };
}

function io(over: Partial<PromoteIo> = {}): { io: PromoteIo; written: Map<string, Uint8Array> } {
  const written = new Map<string, Uint8Array>();
  return {
    written,
    io: {
      manifest: fixtureManifest(),
      lock: syncedLock(),
      readLocal: (dir) => (dir === '20260210000000_add_members' ? BYTES : undefined),
      writePackageFile: (dir, bytes) => written.set(dir, bytes),
      since: '0.2.0',
      slice: 'orgs',
      requires: ['orgs'],
      ...over,
    },
  };
}

describe('promote', () => {
  it('copies the migration into the package, adds a manifest entry and locks it to the SAME local directory', () => {
    const { io: ctx, written } = io();
    const result = promote('20260210000000_add_members', 'add_members', ctx);
    expect(result.changed).toBe(true);
    expect(result.entry).toEqual({
      id: '0004_add_members',
      dir: '0004_add_members',
      sha256: sha256Hex(BYTES),
      since: '0.2.0',
      slice: 'orgs',
      requires: ['orgs'],
    });
    expect(Buffer.from(written.get('0004_add_members')!).equals(BYTES)).toBe(true);
    expect(result.manifest).toHaveLength(4);
    const locked = result.lock.migrations[3]!;
    expect(locked).toEqual({ originId: 'platform:0004_add_members', localDir: '20260210000000_add_members', sha256: sha256Hex(BYTES), since: '0.2.0' });
    expect(result.lock.platformVersion).toBe('0.2.0');
  });

  it('is idempotent: promoting again changes and writes nothing', () => {
    const first = io();
    const once = promote('20260210000000_add_members', 'add_members', first.io);
    const second = io({ manifest: once.manifest, lock: once.lock });
    const again = promote('20260210000000_add_members', 'add_members', second.io);
    expect(again.changed).toBe(false);
    expect(again.manifest).toEqual(once.manifest);
    expect(again.lock).toEqual(once.lock);
    expect(second.written.size).toBe(0);
  });

  it('refuses the same slug with different bytes (released migrations are immutable)', () => {
    const first = io();
    const once = promote('20260210000000_add_members', 'add_members', first.io);
    const changed = io({
      manifest: once.manifest,
      lock: once.lock,
      readLocal: () => Buffer.from('-- different\n'),
    });
    expect(() => promote('20260210000000_add_members', 'add_members', changed.io)).toThrowError(/PROMOTE_CONFLICT/);
  });

  it('refuses a directory that is already locked as another platform migration', () => {
    const { io: ctx } = io({ readLocal: () => BYTES });
    expect(() => promote('20260101000000_initial', 'something_new', ctx)).toThrowError(/PROMOTE_CONFLICT/);
  });

  it('refuses until the app lock holds every package migration', () => {
    const lock = syncedLock();
    lock.migrations.pop();
    const { io: ctx } = io({ lock });
    expect(() => promote('20260210000000_add_members', 'add_members', ctx)).toThrowError(/PROMOTE_NOT_SYNCED/);
  });

  it('refuses a directory that sorts before the last installed platform migration', () => {
    const { io: ctx } = io({ readLocal: () => BYTES });
    expect(() => promote('20250101000000_old', 'add_members', ctx)).toThrowError(/PROMOTE_ORDER/);
  });

  it('refuses invalid arguments and a missing directory', () => {
    expect(() => promote('20260210000000_add_members', 'Add-Members', io().io)).toThrowError(/PROMOTE_INVALID/);
    expect(() => promote('not-a-timestamped-dir', 'add_members', io().io)).toThrowError(/PROMOTE_INVALID/);
    expect(() => promote('20260211000000_missing', 'add_members', io().io)).toThrowError(/PROMOTE_INVALID/);
    expect(() => promote('20260210000000_add_members', 'add_members', io({ requires: ['nope'] }).io)).toThrowError(SyncError);
  });

  it('starts the history at 0001 for an empty package', () => {
    const { io: ctx } = io({ manifest: [], lock: emptyLock('0.0.0'), requires: [], slice: 'core' });
    expect(promote('20260210000000_add_members', 'add_members', ctx).entry.id).toBe('0001_add_members');
  });
});
