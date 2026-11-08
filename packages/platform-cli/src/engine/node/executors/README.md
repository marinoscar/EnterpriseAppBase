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
     readonly input = 'download' as const; // or 'none' | 'url'

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

## Reading the input: `none`, `download` or `url`

Declare exactly one `input` mode on the executor. `download` gives you
`context.inputPath`, a temp file the engine removes. `url` gives you
`context.inputUrl` and downloads nothing, for a tool that range-seeks the object
(ffmpeg, ffprobe): ask `context.refreshInputUrl()` for a fresh one when a long
job outlives the first. The URL is a bearer capability, so never log it, put it
in a span attribute or hand it to a process whose stderr you capture. A
non-faststart MP4 cannot be streamed efficiently: fall back to downloading
inside `execute`.

## Declaring more than a binary

Beyond `registerProbedBinary`, an executor's needs can name `module:<name>` and
`service:<id>` capabilities (`registerCapabilityProbe` with `moduleCapability` /
`httpServiceCapability`), a model file (`registerModelArtifact`) and an install
step (`registerInstallStep`). Each is a one-call registry in
`@marinoscar/platform-cli/node`; the signatures and examples are in the
[package README](../../../node/README.md#extension-point-catalog) and the
operator view is in [Running worker nodes](../../../../../docs/runbooks/run-worker-nodes.md).

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

**Declare an input mode rather than discovering it.** `input` is one of three
values, and declaring it lets a type that needs an input and did not get one
fail with a named error at the top of the job (`MissingJobInputError`) instead
of an opaque `ENOENT … open ''` inside it.

| `input` | The engine | You get |
|---|---|---|
| `'none'` | does nothing | no input |
| `'download'` | fetches the URL and streams the object to a temp file (removed afterwards) | `context.inputPath`, `context.input` |
| `'url'` | fetches the URL and downloads **nothing** | `context.inputUrl`, `context.refreshInputUrl()`, `context.input` |

`requiresInput: true` / `false` is the older spelling of `'download'` /
`'none'` and keeps working. Declare exactly one of the two fields; registering
both is an error.

**Use `'url'` for a tool that range-seeks the object** (ffmpeg, ffprobe): it
reads the header and the bytes around each seek point, so a multi-GB video
costs megabytes. Rules for url mode:

- *The URL is a bearer capability.* Pass it to the tool and nowhere else: never
  log it, put it in a span, a result or an error message (an `execFile` error
  message includes the command line, so wrap it). `checkExecutorCredentialHygiene`
  (`@marinoscar/platform-cli/testing`) hands the executor a signed `inputUrl` and
  flags any place it ends up.
- *It expires.* On a long job call `await context.refreshInputUrl()` before each
  tool invocation: it returns the held URL while more than 60 s remain and
  re-requests it otherwise (single-flight). It rejects in any other mode.
- *Not every input seeks.* A non-faststart MP4 keeps its index at the end, and a
  store that ignores `Range` cannot serve a seek. Fall back inside `execute`:
  try the URL, and on failure stream the object yourself with
  `context.api.downloadUrl(...)` and work on the file. The engine does not do
  this for you.
- The `job.download` span carries `inputMode` (`download` | `url`) and, in
  download mode only, `bytes`; url mode moves no bytes.

See `apps/cli/src/examples/probe.executor.ts` for a worked url-mode executor.

## What the engine guarantees

- The temp file is removed on success, on failure and on drain.
- The lease is renewed for the whole job, download included.
- `context.signal` is aborted on drain; long work should honour it.
- Nothing you return is validated here — the server re-parses it against its
  own schema, which is the definition that actually matters.
