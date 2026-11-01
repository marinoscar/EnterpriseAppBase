# Node executors

The CLI-side half of a job type. A type that a worker
node can run needs **two** things, and they live in two different places:

| Half | Where | What it decides |
|---|---|---|
| Handler | `apps/api/src/jobs/handlers/` | Whether the type may be enqueued, what a result must look like (`nodeResultSchema`), and how to persist one (`persistNodeResult`) |
| Executor | here | Whether *this machine* can run it, and how |

Both are self-registering, and neither knows about the other.

## Adding one

1. Write a class implementing `JobExecutor`:

   ```ts
   export class VideoTranscodeExecutor implements JobExecutor {
     readonly type = 'video.transcode';
     readonly requiresInput = true;

     async execute(context: JobExecutionContext) {
       // Throw to fail. Return the result the server's nodeResultSchema expects.
       return { durationMs: 1234, codec: 'h264' };
     }
   }
   ```

2. Add it to `defaultExecutors()` in `example-checksum.ts`.

3. If it needs a tool on the machine, declare it (see below).

That is the whole wiring. The engine intersects the operator's `--types` with
what is registered here, so a node never claims a type it cannot run — and a
type with no executor is simply left to the API server's in-process worker.

## Declaring what an executor needs, and what it reports

```ts
registerProbedBinary('ffmpeg', { versionArgs: ['-version'] });
registerJobRequirement('video.transcode', {
  required: [binaryCapability('ffmpeg')],
  degradable: [binaryCapability('exiftool')],
});
```

The startup self-test then refuses to claim `video.transcode` on a machine without `ffmpeg` (a hard exit naming the type and the tool, instead of a node that fails every job it claims), warns for the degradable one, and `node doctor` lists both tools with the version the probe captured. Both are exported from `@marinoscar/platform-cli/node`; the worked example is `apps/cli/src/examples/transcode.executor.ts`.

An executor can also time its own phase and report numbers:

- `context.phase('job.app.transcode', work, attributes)` records a relayed span; the name must be `job.app.<name>`, and the attributes are integers or short token-shaped strings (the API relays the keys it registered with `registerNodeSpanAttribute`).
- `vitals(): Record<string, number>` is read on every heartbeat and merged into `vitals.extra` (at most 16 keys fleet-wide; the fleet page words them through the web app's `registerNodeVital`). Keep it cheap and synchronous: it must not spawn a process or touch the network.

## Three rules worth stating

**`execute` returns the result and throws to fail.** Same contract as the
server's handlers. Every provider error, missing file and truncated stream
becomes a reported failure carrying the real message, with nothing to
remember to check.

**Throw `ProviderRateLimitError` for a throttle, and only for a throttle.**
The engine classifies by `instanceof` and never by sniffing a message, so this
is opt-in and cannot be tripped by an unluckily-worded error. It routes the job
through the server's *deferral* path, which does not charge an attempt — and
backs off sibling jobs of the same type on the server too.

**Declare `requiresInput` rather than discovering it.** The engine fetches the
download URL and streams the object to a temp file *before* calling you, and a
type that needs an input and did not get one fails with a named error at the
top of the job. The alternative — an empty path passed downstream — surfaces
much later as `ENOENT … open ''`, which names neither the job nor the type.

## What the engine guarantees

- The temp file is removed on success, on failure and on drain.
- The lease is renewed for the whole job, download included.
- `context.signal` is aborted on drain; long work should honour it.
- Nothing you return is validated here — the server re-parses it against its
  own schema, which is the definition that actually matters.
