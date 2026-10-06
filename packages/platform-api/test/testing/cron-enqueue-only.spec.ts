import { cronEnqueueOnlySuite, type CronEnqueueOnlyOptions } from '../../src/testing';
import { emptySourceRoot, fixtureSourceRoot, removeSourceRoots, writeSource } from '../support/conformance-harness';

afterAll(removeSourceRoots);

const WHY = 'Fixture exemption: the reaper recovers abandoned work and cannot depend on the queue.';

function options(overrides: Partial<CronEnqueueOnlyOptions> = {}): CronEnqueueOnlyOptions {
  return { exempt: [], minCronFiles: 1, ...overrides };
}

/** One minimal cron whose body is `body`. */
const cron = (body: string): string => `export class T {\n  @Cron('0 0 * * *')\n  async tick() {\n${body}\n  }\n}\n`;

const ENQUEUE = '    await this.jobs.enqueue("x");';

/** Each platform marker with a body that trips it, and the finding it must produce. */
const MARKERS: ReadonlyArray<[string, string, string]> = [
  ['.deleteMany(', '    await this.prisma.a.deleteMany({});', 'a bulk delete'],
  ['.updateMany(', '    await this.prisma.a.updateMany({});', 'a bulk update'],
  ['.updateManyAndReturn(', '    await this.prisma.a.updateManyAndReturn({});', 'a bulk update'],
  ['.$executeRaw', '    await this.prisma.$executeRaw`DELETE FROM a`;', 'raw SQL'],
  ['withAdminConnection(', '    await withAdminConnection(async () => 1);', 'a cluster admin connection'],
  ['cleanupExpired*(', '    await this.svc.cleanupExpiredSessions();', 'an inline cleanup call'],
  ['.prune()', '    await this.svc.prune();', 'an inline retention prune'],
  ['dropExpired*(', '    await dropExpiredDatabases();', 'an inline DROP DATABASE sweep'],
  ['this.sweep(', '    await this.sweep();', 'an inline sweep'],
  ['this.releaseStaleRuns(', '    await this.releaseStaleRuns();', 'an inline stale release'],
  ['this.storage.', '    await this.storage.delete("k");', 'a direct storage-provider call'],
  ['this.storageProvider.', '    await this.storageProvider.delete("k");', 'a direct storage-provider call'],
];

describe('cron-enqueue-only suite: check()', () => {
  it.each(MARKERS)('flags %s even when the cron also enqueues', (_marker, body, what) => {
    const root = emptySourceRoot();
    writeSource(root, 'a.task.ts', cron(`${ENQUEUE}\n${body}`));

    const report = cronEnqueueOnlySuite.check({ sourceRoots: [root] }, options());

    expect(report.findings).toEqual([{ file: 'a.task.ts', message: `a @Cron body containing ${what}` }]);
  });

  it('flags a cron that queues nothing', () => {
    const root = emptySourceRoot();
    writeSource(root, 'a.task.ts', cron('    console.log(1);'));

    expect(cronEnqueueOnlySuite.check({ sourceRoots: [root] }, options()).findings).toEqual([
      { file: 'a.task.ts', message: 'a @Cron body that queues nothing' },
    ]);
  });

  it('accepts enqueueHousekeepingJob( as well as .enqueue(', () => {
    const root = emptySourceRoot();
    writeSource(root, 'a.task.ts', cron('    await enqueueHousekeepingJob(this.jobs, "x");'));

    expect(cronEnqueueOnlySuite.check({ sourceRoots: [root] }, options()).findings).toEqual([]);
  });

  it('reports every offender in the fixture tree, and nothing for the compliant or exempt files', () => {
    const root = fixtureSourceRoot();

    const report = cronEnqueueOnlySuite.check(
      { sourceRoots: [root] },
      options({ exempt: [{ file: 'jobs/tasks/exempt.task.ts', why: WHY }], minCronFiles: 6 }),
    );

    expect(report.findings).toEqual(
      expect.arrayContaining([
        { file: 'deletes-inline.task.ts', message: 'a @Cron body containing a bulk delete' },
        { file: 'queues-nothing.task.ts', message: 'a @Cron body that queues nothing' },
        { file: 'nested-braces.task.ts', message: 'a @Cron body containing a bulk update' },
        { file: 'two-crons.task.ts', message: 'a @Cron body containing raw SQL' },
      ]),
    );
    const files = new Set(report.findings.map((finding) => finding.file));
    expect(files.has('compliant.task.ts')).toBe(false);
    expect(files.has('jobs/tasks/exempt.task.ts')).toBe(false);
  });

  it('matches braces across nested blocks and template literals, so work after them is still seen', () => {
    const root = fixtureSourceRoot();

    const findings = cronEnqueueOnlySuite
      .check({ sourceRoots: [root] }, options())
      .findings.filter((finding) => finding.file === 'nested-braces.task.ts');

    // The bulk update sits after four closed inner blocks. `manual()`'s deleteMany
    // is outside the cron body and must not be attributed to it.
    expect(findings).toEqual([{ file: 'nested-braces.task.ts', message: 'a @Cron body containing a bulk update' }]);
  });

  it('documents a limit kept from the original scan: a decorator options object is read as the body', () => {
    // The scan opens the body at the first `{` after `@Cron(`. With an options
    // argument that is the decorator's own object, which contains no enqueue, so
    // the cron is reported as queueing nothing. It fails loudly (never passes
    // silently); the fix is to keep the options out of the decorator or to
    // improve the scan in a change of its own.
    const root = emptySourceRoot();
    writeSource(root, 'a.task.ts', `class T {\n  @Cron('0 0 * * *', { name: 'n' })\n  async tick() {\n${ENQUEUE}\n  }\n}\n`);

    expect(cronEnqueueOnlySuite.check({ sourceRoots: [root] }, options()).findings).toEqual([
      { file: 'a.task.ts', message: 'a @Cron body that queues nothing' },
    ]);
  });

  it('checks every @Cron in a file, not only the first', () => {
    const root = fixtureSourceRoot();

    const findings = cronEnqueueOnlySuite
      .check({ sourceRoots: [root] }, options())
      .findings.filter((finding) => finding.file === 'two-crons.task.ts');

    // The first cron is compliant; only the second is reported, and it is
    // reported twice: it queues nothing and it runs raw SQL.
    expect(findings).toEqual([
      { file: 'two-crons.task.ts', message: 'a @Cron body that queues nothing' },
      { file: 'two-crons.task.ts', message: 'a @Cron body containing raw SQL' },
    ]);
  });

  it('does not scan spec files or files without a @Cron', () => {
    const root = fixtureSourceRoot();

    const report = cronEnqueueOnlySuite.check({ sourceRoots: [root] }, options());

    expect(report.scannedFiles.cronFiles).not.toContain('ignored.spec.ts');
    expect(report.scannedFiles.cronFiles).not.toContain('no-cron.service.ts');
    expect(report.scanned.cronFiles).toBe(report.scannedFiles.cronFiles.length);
  });

  it('skips an exempt file entirely', () => {
    const root = fixtureSourceRoot();

    const report = cronEnqueueOnlySuite.check(
      { sourceRoots: [root] },
      options({ exempt: [{ file: 'jobs/tasks/exempt.task.ts', why: WHY }] }),
    );

    expect(report.findings.map((finding) => finding.file)).not.toContain('jobs/tasks/exempt.task.ts');
    // ...but it still counts as a scanned cron file, which is what the exemption test checks.
    expect(report.scannedFiles.cronFiles).toContain('jobs/tasks/exempt.task.ts');
  });

  it('adds extraWorkMarkers on top of the platform markers', () => {
    const root = emptySourceRoot();
    writeSource(root, 'a.task.ts', cron(`${ENQUEUE}\n    await this.mailer.sendAll();\n    await this.prisma.a.deleteMany({});`));

    const report = cronEnqueueOnlySuite.check(
      { sourceRoots: [root] },
      options({ extraWorkMarkers: [{ pattern: /this\.mailer\./, what: 'an inline mail blast' }] }),
    );

    expect(report.findings.map((finding) => finding.message)).toEqual([
      'a @Cron body containing a bulk delete',
      'a @Cron body containing an inline mail blast',
    ]);
  });

  it('uses relative paths with / separators, per source root', () => {
    const rootA = emptySourceRoot();
    const rootB = emptySourceRoot();
    writeSource(rootA, 'jobs/tasks/a.task.ts', cron('    console.log(1);'));
    writeSource(rootB, 'b.task.ts', cron('    console.log(2);'));

    const report = cronEnqueueOnlySuite.check({ sourceRoots: [rootA, rootB] }, options({ minCronFiles: 2 }));

    expect(report.scannedFiles.cronFiles).toEqual(['jobs/tasks/a.task.ts', 'b.task.ts']);
  });

  it('throws on misconfiguration instead of reporting a finding', () => {
    const root = emptySourceRoot();

    expect(() => cronEnqueueOnlySuite.check({ sourceRoots: [] }, options())).toThrow('sourceRoots is empty');
    expect(() => cronEnqueueOnlySuite.check({ sourceRoots: [root] }, options({ minCronFiles: 0 }))).toThrow('minCronFiles');
    expect(() => cronEnqueueOnlySuite.check({ sourceRoots: [`${root}/missing`] }, options())).toThrow('cannot read source root');
  });
});

describe('cron-enqueue-only suite: cases()', () => {
  it('produces the three test names the app spec has always had', () => {
    const names = cronEnqueueOnlySuite
      .cases(options({ exempt: [{ file: 'a.ts', why: WHY }] }))
      .map((testCase) => testCase.name);

    expect(names).toEqual([
      'finds the crons at all, so a broken scan cannot pass vacuously',
      'exempts a.ts, on the record',
      'queues its work instead of doing it, in every non-exempt cron',
    ]);
  });
});
