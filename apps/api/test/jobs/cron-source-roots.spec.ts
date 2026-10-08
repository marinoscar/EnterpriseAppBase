import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cronEnqueueOnlySuite } from '@marinoscar/platform-api/testing';

import { CRON_SOURCE_ROOTS, SHARING_SLICE_SOURCE_ROOT, TELEMETRY_SLICE_SOURCE_ROOT } from './cron-source-roots';

// =============================================================================
// The cron rule demonstrably scans the packaged telemetry slice (issue #703)
// =============================================================================
//
// `cron-enqueue-only.spec.ts` passes when every cron it SEES enqueues; this
// proves what it sees. The telemetry retention task is found under the
// package's root, and a deliberately bad cron placed in a copy of that root is
// a finding.
// =============================================================================

const OPTIONS = { exempt: [], minCronFiles: 1 };

describe('cron-enqueue-only source roots', () => {
  it('include the packaged telemetry slice, and its retention task is scanned', () => {
    expect(CRON_SOURCE_ROOTS).toContain(TELEMETRY_SLICE_SOURCE_ROOT);

    const report = cronEnqueueOnlySuite.check({ sourceRoots: [TELEMETRY_SLICE_SOURCE_ROOT] }, OPTIONS);

    expect(report.scannedFiles.cronFiles).toContain('tasks/telemetry-retention.task.ts');
    expect(report.findings).toEqual([]);
  });

  it('include the packaged sharing slice, and its grants prune task is scanned (#729)', () => {
    expect(CRON_SOURCE_ROOTS).toContain(SHARING_SLICE_SOURCE_ROOT);

    const report = cronEnqueueOnlySuite.check({ sourceRoots: [SHARING_SLICE_SOURCE_ROOT] }, OPTIONS);

    expect(report.scannedFiles.cronFiles).toContain('jobs/grants-prune.task.ts');
    expect(report.findings).toEqual([]);
  });

  it('a cron that works inline inside a slice root is a finding', () => {
    const root = mkdtempSync(join(tmpdir(), 'cron-roots-'));
    try {
      mkdirSync(join(root, 'tasks'));
      writeFileSync(
        join(root, 'tasks', 'bad.task.ts'),
        [
          "import { Cron } from '@nestjs/schedule';",
          'export class BadTask {',
          "  @Cron('0 4 * * *')",
          '  async handleCron() {',
          '    await this.prisma.telemetryRow.deleteMany({});',
          '  }',
          '}',
        ].join('\n'),
      );

      const report = cronEnqueueOnlySuite.check({ sourceRoots: [TELEMETRY_SLICE_SOURCE_ROOT, root] }, OPTIONS);

      // Two findings for one body: it queues nothing, and it does a bulk delete.
      expect(report.findings.length).toBeGreaterThan(0);
      expect(new Set(report.findings.map((finding) => finding.file))).toEqual(new Set(['tasks/bad.task.ts']));
      expect(report.findings.map((finding) => finding.message).join('\n')).toMatch(/bulk delete/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
