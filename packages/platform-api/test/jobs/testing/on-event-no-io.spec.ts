import { runPlatformConformance } from '../../../src/testing';
import { eventListenerBodies, listenerIoMarkers, onEventNoIoSuite } from '../../../src/jobs/testing';
import type { OnEventNoIoOptions } from '../../../src/jobs/testing';
import { emptySourceRoot, outcome, recordingTestApi, removeSourceRoots, writeSource } from '../../support/conformance-harness';

afterAll(removeSourceRoots);

// The listener decorator, spelled out in test source only (test files are not scanned by any app).
const LISTENER = (event: string, body: string): string =>
  `class L {\n  @OnEvent('${event}', { async: true })\n  async handle({ job }: Event): Promise<void> {\n${body}\n  }\n}\n`;

/** A tree of five compliant listeners, one per file. */
function compliantRoot(): string {
  const root = emptySourceRoot();
  for (let i = 0; i < 5; i += 1) {
    writeSource(root, `listeners/ok-${i}.listener.ts`, LISTENER(`thing.${i}`, '    await this.audit.record({ job });'));
  }
  return root;
}

async function run(root: string, options: OnEventNoIoOptions): Promise<Map<string, Error | null>> {
  const { api, tests } = recordingTestApi();
  runPlatformConformance({ sourceRoots: [root], suites: { onEventNoIo: options }, testApi: api });
  const results = new Map<string, Error | null>();
  for (const test of tests) {
    if (test.name.startsWith('platform conformance')) continue;
    results.set(test.name.split(' > ')[1]!, await outcome(test));
  }
  return results;
}

describe('the on-event-no-io suite', () => {
  it('registers under its id and option key, with the pre-move case list', async () => {
    expect(onEventNoIoSuite.id).toBe('on-event-no-io');

    const results = await run(compliantRoot(), { minListenerFiles: 5 });

    // The seven cases of the original apps/api/test/jobs/on-event-no-io.spec.ts: three scan cases, four detector cases.
    expect([...results.keys()]).toEqual([
      'finds the listeners at all, so a broken scan cannot pass vacuously',
      "scans the packaged slices' listeners, not only the app's",
      'keeps object bytes out of every event listener',
      'the detector reads the method body, not the decorator options object',
      'the detector ignores the decorator named in a comment',
      'the detector skips stacked decorators',
      'the detector catches the listener #520 removed',
    ]);
    for (const [name, error] of results) expect([name, error]).toEqual([name, null]);
  });

  describe('fails on a planted violation', () => {
    it('a listener that downloads from storage: the #520 body, by file name and marker', async () => {
      const root = compliantRoot();
      writeSource(
        root,
        'storage/object-processing.service.ts',
        LISTENER('storage.object.uploaded', '    const bytes = await this.storageProvider.download(event.object.storageKey);'),
      );

      const results = await run(root, { minListenerFiles: 5 });
      const failure = results.get('keeps object bytes out of every event listener');

      expect(failure).not.toBeNull();
      expect(failure!.message).toContain('storage/object-processing.service.ts');
      expect(failure!.message).toContain('an event listener body containing a direct storage-provider call');
      expect(failure!.message).toContain('an event listener body containing a download');
      // Only that case fails; the compliant files stay clean.
      expect(failure!.message).not.toContain('listeners/ok-');
    });

    it('a listener that uploads', async () => {
      const root = compliantRoot();
      writeSource(root, 'bad.listener.ts', LISTENER('x.y', '    await archive.upload(event.key, event.bytes);'));

      const failure = (await run(root, { minListenerFiles: 5 })).get('keeps object bytes out of every event listener');

      expect(failure!.message).toContain('bad.listener.ts: an event listener body containing an upload');
    });

    it('an app marker added through extraIoMarkers', async () => {
      const root = compliantRoot();
      writeSource(root, 'bad.listener.ts', LISTENER('x.y', '    await this.mailer.sendBulk(event.list);'));

      const clean = await run(root, { minListenerFiles: 5 });
      const marked = await run(root, {
        minListenerFiles: 5,
        extraIoMarkers: [{ pattern: /\.sendBulk\(/, what: 'a bulk send' }],
      });

      expect(clean.get('keeps object bytes out of every event listener')).toBeNull();
      expect(marked.get('keeps object bytes out of every event listener')!.message).toContain('a bulk send');
    });

    it('a scan that finds fewer listeners than the app expects (a moved tree cannot pass vacuously)', async () => {
      const results = await run(compliantRoot(), { minListenerFiles: 6 });

      expect(results.get('finds the listeners at all, so a broken scan cannot pass vacuously')).not.toBeNull();
    });

    it('a listener file the app says must be scanned but is not', async () => {
      const results = await run(compliantRoot(), { minListenerFiles: 5, mustScan: ['nodes/ops/node-secret-revoker.ts'] });

      expect(results.get("scans the packaged slices' listeners, not only the app's")).not.toBeNull();
    });
  });

  it('passes a listener file the app names in mustScan', async () => {
    const results = await run(compliantRoot(), { minListenerFiles: 5, mustScan: ['listeners/ok-3.listener.ts'] });

    expect(results.get("scans the packaged slices' listeners, not only the app's")).toBeNull();
  });

  it('refuses a misconfiguration instead of passing: no minimum, or an unreadable root', async () => {
    const { api, tests } = recordingTestApi();
    runPlatformConformance({
      sourceRoots: [join0('does-not-exist')],
      suites: { onEventNoIo: { minListenerFiles: 1 } },
      testApi: api,
    });
    expect((await outcome(tests[0]!))!.message).toContain('cannot read source root');

    const zero = recordingTestApi();
    runPlatformConformance({ sourceRoots: [compliantRoot()], suites: { onEventNoIo: { minListenerFiles: 0 } }, testApi: zero.api });
    expect((await outcome(zero.tests[0]!))!.message).toContain('minListenerFiles must be a positive integer');
  });

  it('can be skipped by an app with a reason', () => {
    const { api, tests } = recordingTestApi();
    runPlatformConformance({
      sourceRoots: [compliantRoot()],
      suites: { onEventNoIo: { skip: 'No listeners in this app.' } },
      testApi: api,
    });

    expect(tests[0]!.name).toContain('skipped by the app (No listeners in this app.)');
  });

  describe('the helpers', () => {
    it('read the method body, not the options object', () => {
      const [body] = eventListenerBodies(LISTENER('a.b', '    await this.other.thing({ nested: true });'));

      expect(body).toContain('this.other.thing');
    });

    it('report each marker once per body', () => {
      expect(listenerIoMarkers('{ await this.storage.download(k); }')).toEqual(['a direct storage-provider call', 'a download']);
      expect(listenerIoMarkers('{ await this.jobs.enqueue(x); }')).toEqual([]);
    });
  });
});

function join0(name: string): string {
  return `${emptySourceRoot()}/${name}`;
}
