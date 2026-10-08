// `npm run storage:purge` (issue #679; packaged in #736): the entry point
// enumerates exactly the registered prefixes of the booted app, in registry
// order, with the JSON report shape the CLI renders. The Nest context and the
// S3 client are stand-ins; the prefix list is the real registry, filled by the
// app's real manifest.

interface SentCommand {
  name: string;
  input: Record<string, unknown>;
}

const PLATFORM_PREFIXES = [
  'uploads/',
  'avatars/',
  'database-backups/',
  'node-outputs/',
  'ai-outputs/',
  'storage-config-test/',
];

/** Runs the entry point once with `argv` and returns its stdout and S3 traffic. */
async function runPurge(argv: string[]): Promise<{ stdout: string; sent: SentCommand[]; exitCode: unknown }> {
  const sent: SentCommand[] = [];
  let closed!: () => void;
  const done = new Promise<void>((resolve) => (closed = resolve));
  const chunks: string[] = [];

  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const write = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  });

  const command = (name: string) =>
    class {
      readonly name = name;
      constructor(readonly input: Record<string, unknown>) {}
    };

  try {
    process.argv = ['node', 'storage-purge.main.js', ...argv];

    jest.isolateModules(() => {
      // Booting the real app is what registers the prefixes (#736: the purge
      // reads `allKeyPrefixes()` of the booted app); the stand-in AppModule
      // loads the same manifest `platform/storage/storage.config.ts` does.
      jest.doMock('./app.module', () => {
        require('./platform/storage/storage-key-prefix.manifest');
        return { AppModule: class AppModule {} };
      });
      jest.doMock('@aws-sdk/client-s3', () => ({
        GetBucketVersioningCommand: command('GetBucketVersioning'),
        ListObjectsV2Command: command('ListObjectsV2'),
        ListObjectVersionsCommand: command('ListObjectVersions'),
        DeleteObjectsCommand: command('DeleteObjects'),
        S3Client: class {
          async send(cmd: SentCommand): Promise<unknown> {
            sent.push({ name: cmd.name, input: cmd.input });
            if (cmd.name === 'ListObjectsV2') {
              return { Contents: [{ Key: `${String(cmd.input.Prefix)}object-1`, Size: 10 }], IsTruncated: false };
            }
            return {};
          }
        },
      }));
      jest.doMock('@nestjs/core', () => ({
        NestFactory: {
          createApplicationContext: async () => ({
            get: () => ({
              resolveActiveConfig: async () => ({ provider: 's3', bucket: 'the-bucket', region: 'us-east-1' }),
            }),
            close: async () => closed(),
          }),
        },
      }));

      require('./storage-purge.main');
    });

    await done;
    return { stdout: chunks.join(''), sent, exitCode: process.exitCode };
  } finally {
    write.mockRestore();
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    jest.resetModules();
  }
}

describe('storage-purge.main', () => {
  it('a dry run (--json) reports the six registered prefixes, in order, and deletes nothing', async () => {
    const { stdout, sent } = await runPurge(['--json']);
    const report = JSON.parse(stdout);

    expect(Object.keys(report)).toEqual([
      'bucket',
      'provider',
      'endpoint',
      'versioning',
      'prefixes',
      'totals',
      'deleted',
      'dryRun',
    ]);
    expect(report.prefixes).toEqual(PLATFORM_PREFIXES.map((prefix) => ({ prefix, objects: 1, bytes: 10 })));
    expect(report).toMatchObject({
      bucket: 'the-bucket',
      provider: 's3',
      endpoint: null,
      versioning: 'unversioned',
      totals: { objects: 6, bytes: 60 },
      deleted: 0,
      dryRun: true,
    });
    expect(sent.filter((c) => c.name === 'ListObjectsV2').map((c) => c.input.Prefix)).toEqual(PLATFORM_PREFIXES);
    expect(sent.some((c) => c.name === 'DeleteObjects')).toBe(false);
  });

  it('--confirm with the right bucket deletes under exactly those prefixes', async () => {
    const { stdout, sent } = await runPurge(['--confirm', '--bucket', 'the-bucket']);
    const report = JSON.parse(stdout);

    expect(report).toMatchObject({ dryRun: false, deleted: 6 });
    expect(
      sent
        .filter((c) => c.name === 'DeleteObjects')
        .map((c) => (c.input.Delete as { Objects: Array<{ Key: string }> }).Objects.map((o) => o.Key)),
    ).toEqual(PLATFORM_PREFIXES.map((prefix) => [`${prefix}object-1`]));
  });
});
