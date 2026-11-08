# Worker-node harvest: MemoriaHub node CLI vs the platform node engine

The confirmatory diff behind epic #1070 (RETRO-G2), written for issue #1071 (RETRO-G2.1). It compares the worker-node CLI that MemoriaHub forked (`apps/cli/src/node/*` and `apps/cli/src/commands/node.ts` in the MemoriaHub repository, plus its worker image and compose bundle) with the platform engine (`packages/platform-cli/src/engine/node/*`, public surface `@marinoscar/platform-cli/node`). Its job is to decide, per capability, whether the platform already has it, needs it (fix upstream in G2.2 to G2.4), or should not take it (keep app-side in MemoriaHub RETRO-C10, or decline), and to trim or extend the three child issues accordingly.

This page names MemoriaHub because it lives under `docs/platform-adoption/`, not in a package. MemoriaHub references are `file:line` in that repository and are not links. Platform references are `file:line` in this repository, at the commit this report was written against.

## Contents

- [1. Summary](#1-summary)
- [2. Capability table](#2-capability-table)
- [3. Behaviour differences that matter](#3-behaviour-differences-that-matter)
- [4. Environment variable mapping](#4-environment-variable-mapping)
- [5. Exit codes](#5-exit-codes)
- [6. Executor mapping for RETRO-C10](#6-executor-mapping-for-retro-c10)
- [7. Rejected on purpose, and security](#7-rejected-on-purpose-and-security)
- [8. Scope changes for G2.2 to G2.5](#8-scope-changes-for-g22-to-g25)
- [9. Decisions the maintainers need to make](#9-decisions-the-maintainers-need-to-make)

## 1. Summary

The epic's preliminary table held up: the platform engine already absorbed most of the operational hardening (watchdog and valve with the snapshot written first, IPC heap snapshot, heap re-exec, headless drain, re-attach, rate-limit forwarding, redacting log with rollover, systemd unit). The careful read confirmed the gaps the epic named and found several more that a grep did not show. Status counts over the 34 rows in section 2: 14 present at parity or better, 11 partial, 7 missing, 2 platform-only.

Top gaps, in the order they should be fixed:

1. **A carried-over `HEAP_RESTART_FRACTION=0` would arm the valve at 50 percent, not disable it.** The platform clamps the threshold into `[0.5, 0.99]` (`memory-watchdog.ts:102-108`); MemoriaHub treats `0` as "valve off" (`memory-watchdog.ts:218-226`, `commands/node.ts:773-790`). A plain env alias would turn a documented opt-out into a worker that recycles itself constantly. G2.2 must map `0` to "valve off" explicitly.
2. **No libvips/sharp cap, and the alias list in #1072 omits `MEMORIAHUB_URL`.** `configureSharpRuntime` (`runtime-tuning.ts:229-260`) has no platform equivalent, and `URL` maps to `<PREFIX>SERVER_URL`, which is not a suffix rename. See rows 11 and 26.
3. **The valve drain is unbounded in the platform.** `await this.options.stop()` (`memory-watchdog.ts:257`) waits for every in-flight job; MemoriaHub bounds the drain at 60 s (`commands/node.ts:142,811-815`). One wedged job defeats the valve and the worker OOMs anyway. New scope for G2.2.
4. **Capability probing and install steps are synchronous.** `probeCapabilities` (`capabilities.ts:278`), `runStartupSelfTest` (`:454`), `InstallStep.install` (`install-deps.ts:55`) and `runInstallDeps` (`:166`) return synchronously; every MemoriaHub probe and step that matters (HTTP sidecar status, Docker, model download) is async. G2.4 is an async refactor, not just three registries.
5. **Operational self-test (installed versus operational) is a MemoriaHub-only concept** (`self-test.ts:96-284`, `capabilities.ts:302-340`). The platform probes presence only. G2.4's `available | installed | missing` status is the right shape, but the platform must also make a required `installed` capability block startup, as MemoriaHub does.
6. **Model artifacts: take a static registry, decline the server manifest.** The platform rejected a model manifest on purpose (`packages/platform-api/src/nodes/nodes.service.ts:48-54`). G2.4 should build the app-declared registry only and drop the optional server route.
7. **The engine cannot hand an executor a URL without the executor calling the API itself** (`registerNodeExecutor` requires a boolean `requiresInput`, `executors/registry.ts:54`). This is already possible today through `context.api.downloadUrl` (`executors/index.ts:38-66`), so G2.3 is ergonomics (mode flag, span, refresh), and MemoriaHub has exactly one URL-mode type (`video_auto_tagging`, `node-engine.ts:177`).
8. **Three of ten MemoriaHub executors need provider keys on the node** (`auto_tagging`, `video_auto_tagging`, `geocode`). That is rejected by the platform today and is the subject of seam #1083 (`needs-decision`). Until it is decided, RETRO-C10 either leaves those three server-only or waits.

Smaller findings worth knowing before coding are in section 3: the default-node-name change (`worker-<host>` versus `<host>`) would create duplicate node rows on a migrating fleet, the trend window is 10 minutes in the platform and 30 in MemoriaHub, and the default-concurrency formulas differ by a factor of two on the 16 GB baseline.

## 2. Capability table

Status values: **present** (equivalent or better), **partial** (exists, behaviour differs or part is missing), **missing** (no platform equivalent), **platform-only** (the platform has it and MemoriaHub does not). Decision values: **no work**, **G2.x** (upstream), **app-side** (MemoriaHub RETRO-C10), **decline** (with reason), **seam** (#1083).

MemoriaHub paths are under `apps/cli/src/`; platform paths are under `packages/platform-cli/src/engine/node/` unless they start with another directory.

| # | Capability | MemoriaHub | Platform | Status | Decision |
|---|---|---|---|---|---|
| 1 | Daemon, pidfile, socket permissions | `node/daemon.ts:243` pidfile as JSON `{pid,...}` mode 0600; `:500` socket `chmod 0600`; stale pidfile and stale socket reclaimed before listen (`:51-52`) | `pidfile.ts:58-60` pid as a bare integer, mode 0600; `daemon.ts:147` `chmod(socketPath, 0o600)`; `pidfile.ts:32-35` `kill(pid,0)` stale check; `lifecycle.ts:59` stop ladder | present | no work. The pidfile format differs, but nothing outside the CLI reads it |
| 2 | IPC commands and frames | `node/daemon.ts:17-31,284-452`: `{cmd}` in, `{kind}` out; `status, set-concurrency, drain, stop, heap-snapshot` plus four `backup-*` verbs; frames `snapshot, log-tail, event, backup-event, status, ack, error` | `ipc-protocol.ts:28-44`: `{type}` in and out; same five commands, no backup verbs; frames `snapshot, log-tail, event, ack, error`; 1 MiB client backlog cap (`:44`, same as MemoriaHub `daemon.ts:87`) | present | no work for the node verbs. The wire formats are incompatible, which is harmless: client and daemon ship in one CLI. The four `backup-*` verbs are app-side (row 33) |
| 3 | Headless mode and SIGTERM drain | `commands/node.ts:739-750`: headless drains with `deregister:false`; `register.ts:33-38` `HEADLESS=1` | `start.ts:250-255` same contract; `node-engine.ts:346-360` `stop({deregister})`; `worker-env.ts:77` | present | no work. The platform accepts `true/1/yes/on` (`env-flags.ts:17-20`), a superset |
| 4 | Register, re-attach, enroll | `node/register.ts:64` default name `worker-<host>`; `node/enroll.ts:77` `enrollNode`; `commands/node.ts:538` headless auto-register | `enrollment.ts:156` `registerNode` (re-attach reported); `:232` `enrollNode`; `start.ts:150` auto-register; `node-config.ts:113` default name is the bare hostname | partial | G2.5 documents it. **Default name differs** (`worker-<host>` versus `<host>`); re-attach keys on the name, so a migrating fleet that relied on the default registers duplicate rows. RETRO-C10 must set `NODE_NAME` or `NODE_ID` explicitly (section 3.6) |
| 5 | Claim loop, lease renew, input download | `node/node-engine.ts:~340-420` top-up claim loop; `:429` fixed 30 s renew; `:452` download to temp file; temp file removed at `:534` | `node-engine.ts:443-488` claim loop; `:552-561` renew interval taken from the server's `renewIntervalMs`; `:719-756` `downloadInput` streams to a 0600 temp file; `:767` renew failure non-fatal; claim tokens (#364) | present | no work. The platform is stricter (claim token, server-owned cadence) |
| 6 | Executor contract | `node/capabilities.ts:392-440` `ComputeFn(inputPath, params, ctx)` and `ComputeDispatcher`; result submitted by the engine (`node-engine.ts:~470`) | `executors/index.ts:146-176` `JobExecutor {type, requiresInput, execute(context), vitals?}`; `executors/registry.ts:46` `registerNodeExecutor`; execute returns the result and throws to fail | present | no work. Mapping for the ten executors is in section 6 |
| 7 | Rate-limit forwarding | `node/node-engine.ts:504-513` `instanceof ProviderRateLimitError` then `{rateLimited, retryAfterMs}`; sends `willRetry:true` | `node-engine.ts:664-707` the same `instanceof` rule; server ignores `willRetry` (`nodes.service.ts:38-47`) | present | G2.3: parity test only, as planned |
| 8 | Memory watchdog and trend | `node/memory-watchdog.ts:165-203` 60 s sample, `warn` line at 0.85, ring 1 h (`:92`), trend withheld below 30 min and 5 samples (`:104-124`) | `memory-watchdog.ts:145-260` 30 s sample (`:51`), ring 480 (`:57`), trend after 10 min and 3 samples (`:54,119`); logs only when the valve fires; state surfaces through heartbeat vitals (`start.ts:177`) | partial | G2.2: decide the window (section 3.3); consider a periodic log line. The sampling logic itself is at parity |
| 9 | Pre-OOM valve: order, exit, snapshot | `commands/node.ts:773-818`: snapshot, log, drain bounded 60 s, `exit(75)` | `memory-watchdog.ts:229-262`: snapshot first, log, `await stop()` unbounded, `exit(71)`; order stated in the header (`:12-30`) | partial | G2.2: **bound the drain**; exit code option optional (section 5). Order of operations is at parity |
| 10 | Heap snapshot (valve, IPC, near-limit flag) | `node/heap-snapshot.ts:169` `writeWorkerHeapSnapshot`; keep newest 2 (`:55`); disk headroom 1.5x (`:62`); IPC `daemon.ts:307`; `--heapsnapshot-near-heap-limit=1` in `runtime-tuning.ts:128-136` | `heap-snapshot.ts:76` `writeHeapSnapshot`; keep newest 5 (`:39`); headroom 1.5x (`:36`); IPC `daemon.ts:214`; `node heap-snapshot` command (`engine/commands/node.ts:513`) | present | no work. No near-heap-limit launch flag in the platform re-exec (`runtime-tuning.ts:~190`); not needed once the valve snapshots first (see header of `memory-watchdog.ts`) |
| 11 | Heap ceiling and re-exec | `node/runtime-tuning.ts:57-59` floor 4096, cap 12288 MB, 256 MB steps (`:69-76`); `maybeReexecWithHeapLimit` (`:157`); latch `HEAP_TUNED` | `runtime-tuning.ts:49-55` floor 512, cap 8192 MB; **explicit env clamped to the same band** (`:80-82`); `maybeReexecWithHeapLimit` (`:149`) with latch plus limit-in-force guards and signal forwarding | partial | G2.2: decide the bounds (section 3.2). Re-exec mechanics are at parity (platform adds the re-raise of a terminating signal) |
| 12 | Default concurrency | `node/runtime-tuning.ts:264-278` half the cores, one per 4 GB, clamp `[2,4]` | `runtime-tuning.ts:107-118` cores minus one, one per GB, clamp `[1,64]` | partial | decline a formula change; app-side: MemoriaHub sets `CONCURRENCY` (its compose already defaults to 2, `docker-compose.worker.yml:67`). Optional ceiling hook noted in section 3.4 |
| 13 | libvips/sharp thread cap and cache | `node/runtime-tuning.ts:229-260` `configureSharpRuntime` (`sharp.cache(false)`, `sharp.concurrency(n)`), `resolveSharpConcurrency` `min(max(cores/2,1),4)`; called before `engine.start()` (`commands/node.ts:764`) | none | missing | G2.2 as planned: `registerWorkerRuntimeHook` plus `NATIVE_THREADS`. The reference hook must set both the cache and the concurrency |
| 14 | Capability probe: binaries | `node/capabilities.ts:84-97,204-240` `ffmpeg`, `ffprobe` (`-version`, 5 s) | `capabilities.ts:135,186,278` `registerProbedBinary`, `PROBED_BINARIES`, `readRegisteredVersion` | present | no work |
| 15 | Capability probe: npm modules | `node/capabilities.ts:50-82,209-215` `onnxruntime-node`, `sharp`, `tesseract.js` by `require.resolve` | none (`binary:` keys only) | missing | G2.4: `moduleCapability(name)` |
| 16 | Capability probe: HTTP services | `node/capabilities.ts:100-130,219` bounded `GET {url}/status`, 3 s | none | missing | G2.4: `httpServiceCapability`; requires the async probe refactor (section 3.5) |
| 17 | Required versus degradable requirements | `node/capabilities.ts:169-181` map of required keys; optional libraries are simply omitted | `capabilities.ts:65-76,94` `{required, degradable}`, `registerJobRequirement` (`:220`), warn versus exit | present | no work. The platform model is the explicit version of MemoriaHub's convention |
| 18 | Operational self-test and startup gate | `node/self-test.ts:96-284` real sharp decode, CLIP embed, tesseract init, CompreFace status, each with a timeout; `capabilities.ts:302-340` `evaluateStartupSelfTest` blocks only on required caps that are not operational; default on in headless (`register.ts:47-56`); exit 1 (`commands/node.ts:657`) | `start.ts:121-141` presence-only gate in headless; exit 70 (`start.ts:73`); `capabilities.ts:402,454` | partial | G2.4: probes return `available | installed | missing`; `installed` for a required key blocks, for a degradable key warns. The operational tests themselves (decode, embed) are app probe implementations, app-side |
| 19 | Startup self-test switch | `node/register.ts:47-56` `MEMORIAHUB_STARTUP_SELFTEST` | `start.ts:63,121` option only; no env key in `worker-env.ts:60-97` | missing | G2.2: add a `SELF_TEST` key and alias |
| 20 | Heartbeat capability payload | `node/node-engine.ts:551-554`, `capabilities.ts:363` presence re-detected each beat and merged with the cached operational snapshot | `start.ts:187` probe captured once at start; `node-engine.ts:859` | partial | G2.4: refresh the cheap presence probes per beat, keep the heavy results cached |
| 21 | Doctor and doctor summary | `commands/node.ts:1393-1600`; `node/doctor-summary.ts:51-212` rows installed versus operational, job-type readiness, startup gate PASS or BLOCKED, setup-guide link | `doctor.ts:88-488` checks `runtime, job-capabilities, probed-binaries, state-dir, api-*, daemon, pg-dump, database-reachable`; `pass/warn/fail/skip`; `--json` | partial | G2.4: register module and service probes into `job-capabilities`; the installed-versus-operational yellow state maps to `warn`. Rendering stays platform-owned |
| 22 | install-deps steps | `node/install-deps.ts:205-749` async: apt (`:251`), ffmpeg (`:290`), npm native deps (`:333`), tesseract data (`:431`), Docker (`:479`), CompreFace container (`:623`), models (`:749`); sudo announced (`:205`) | `install-deps.ts:113` two generic steps; `InstallDepsOptions.steps` already accepted (`:145`) but `node install-deps` never passes any (`engine/commands/node.ts:464-479`); steps are **synchronous** (`:55,166`) | partial | G2.4: `registerInstallStep`, async steps, `--only`, helpers `ensureAptPackages`, `runWithSudoAnnounced`, `ensureDockerContainer`. The ffmpeg, npm, tesseract and CompreFace steps are app-side |
| 23 | Model artifacts | `node/models.ts:21-130` `ensureModels`: manifest entries `{name,url,sha256,bytes,targetSubdir}`, retry, `.partial`, size and hash check, EXDEV copy; `MODELS_DIR` (`:70`); manifest from `GET /api/nodes/models/manifest` (`commands/node.ts:593-613`) | none; manifest rejected on purpose (`packages/platform-api/src/nodes/nodes.service.ts:48-54`) | missing | G2.4: static app-declared registry with a `targetSubdir`. **Decline the optional server manifest route** (section 7) |
| 24 | Logger: format, redaction, rotation | `node/logger.ts:39,49,172-198` JSONL, 5 MB single rollover to `node.log.1`, redaction by key name | `logger.ts:57,122-151,221-240` JSONL, single rollover, redaction by key name and by value (signed URLs, `pat_`/`nod_` tokens, `PGPASSWORD`), file mode 0600 | present | no work (platform stricter) |
| 25 | systemd service install | `commands/node.ts:1251-1320` unit with `Restart=on-failure`, `RestartSec=5`, **no `--headless`**, no `TimeoutStopSec` | `service.ts:70-93` `Restart=on-failure`, `--headless`, `TimeoutStopSec=300`, `KillSignal=SIGTERM` | present | no work. The MemoriaHub unit would leak a node row per restart; the platform unit does not. If #1072 adds `memoryValveExitCode`, `service.ts` needs `RestartForceExitStatus` |
| 26 | Environment variable names | see section 4 | `worker-env.ts:60-97` one map, `<PREFIX>` from `envPrefix()` | partial | G2.2 aliases, with the corrections in section 4 |
| 27 | Daemon launch | `node/daemon-launch.ts:55-81` spawns detached with the heap flags and the tuned env, so the child never re-execs | `lifecycle.ts:340` `spawnDetachedDaemon`; the child performs its own re-exec (one extra fork) | present | no work |
| 28 | TUI dashboard attach | Ink dashboard attaches to the daemon (`commands/node.ts` TUI wiring; `node/ipc-client.ts`); in-process fallback with tightened watchdog (`memory-watchdog.ts:233-258`) | `node-dashboard-source.ts:70` data source over the same snapshot and event stream | partial | app-side: the Ink screen is MemoriaHub UI. Decline the in-process fallback and `untunedWatchdogOptions`: the platform has no in-process engine host |
| 29 | `node list`, `node doctor` extras | `commands/node.ts:1341` `node list`; doctor hits `GET /api/nodes/models/manifest` | no `node list`; the fleet page lives in the web app (Worker Nodes) | missing | decline `node list`: the admin page and `node status` cover it |
| 30 | Worker container image and compose | `apps/cli/Dockerfile:29-171` multi-stage: ffmpeg, HEIF-enabled libvips, baked CLIP and tesseract models, `STOPSIGNAL SIGTERM`; `docker-compose.worker.yml:29-75` CompreFace sidecar, `restart: unless-stopped`, `stop_grace_period: 180s` | `packages/platform-infra/compose/worker.compose.yml` `restart`, `stop_grace_period: 300s`, `<PREFIX>` env; `worker.build.compose.yml` builds `apps/cli/Dockerfile` | present | app-side: MemoriaHub builds its own image from its own Dockerfile. The generated compose already carries every platform worker variable |
| 31 | Power, sleep and low-disk events | none | `power-probe.ts`, `power-watcher.ts:25-29,53`, polled by the engine (`node-engine.ts:129,270`) | platform-only | no work; MemoriaHub gains it on adoption |
| 32 | Host vitals, telemetry relay, job spans | none (MemoriaHub heartbeat carries capabilities only) | `host-vitals.ts:107`, `node-vitals.ts:214`, `host-telemetry.ts:35`, span relay (`node-engine.ts:272`), event queue (`node-events-queue.ts`) | platform-only | no work; needs the matching server slice (jobs and nodes) in the app |
| 33 | Backup hosting inside the daemon | `node/daemon.ts:17-31,325-441` hosts `BackupHost` and four `backup-*` verbs (issue #318, Local Media Backup) | none, and no extension hook on `DaemonHostOptions` (`daemon.ts:43-52`) | missing | app-side. Not part of epic #1070. RETRO-C10 either keeps backup as its own command or files a seam request for a daemon command hook |
| 34 | Node events contract | `node/node-events.ts:11-25` eleven event names, `EventEmitter` | `node-events.ts`, `node-events-queue.ts`: typed `NodeEngineEvent` union, plus a relay to the server | present | no work |

## 3. Behaviour differences that matter

These are the places where an identical-looking feature behaves differently. Each one is a way for a migrated worker to change behaviour silently.

### 3.1 Valve disable and threshold range

MemoriaHub: `HEAP_RESTART_FRACTION` is a fraction in `(0, 1]`; `0` disables the valve but sampling continues; out-of-range input is ignored in favour of the default (`node/memory-watchdog.ts:218-226`, valve armed only when `restartFraction > 0` at `:197`).

Platform: `MEMORY_THRESHOLD` is clamped into `[0.5, 0.99]` (`memory-watchdog.ts:102-108`), so `0` becomes `0.5`. The only off switch is `MEMORY_WATCHDOG=false`, which also stops sampling and vitals (`start.ts:232`). A straight alias would arm the valve at 50 percent. G2.2 should map an aliased `0` to "valve off, sampling on", which needs either a new "valve disabled" state in `MemoryWatchdog` or a documented decision that disabling the valve disables the watchdog.

### 3.2 Heap bounds

MemoriaHub derives 50 percent of RAM, rounded down to 256 MB, clamped to `[4096, 12288]`, and uses an explicit override verbatim, including above 12288 (`node/runtime-tuning.ts:69-76`). On a 16 GB host both land on 8192 MB. They differ elsewhere:

| Host | MemoriaHub default | Platform default |
|---|---|---|
| 4 GB | 4096 (floor, equal to all RAM) | 2048 |
| 16 GB | 8192 | 8192 |
| 32 GB | 12288 | 8192 |
| explicit `12000` | 12000 | 8192 (clamped, `runtime-tuning.ts:80-82`) |

The platform's lower floor is the saner behaviour on small hosts and should stay. The explicit-override clamp is the problem: a fleet that sets `MAX_OLD_SPACE_MB=12000` gets 8192 with no message. See decision D2.

### 3.3 Trend window

MemoriaHub withholds `heapGrowthMbPerHour` until the readings span 30 minutes and number at least 5, and fits the last hour only (`node/memory-watchdog.ts:92,104-124`). Its documentation (`docs/worker-container-config.md` section 3.5) explains why: a bounded GC sawtooth fits to about 100 MB/h over 12 minutes and about 4 MB/h over an hour, so a short window reports a phantom leak. The platform reports after 10 minutes and 3 samples and fits every retained sample, up to 480 (`memory-watchdog.ts:54,57,119`). The platform number feeds the fleet page through vitals, where a phantom leak is more visible than in a log. Recommend aligning to 30 minutes; this is a default change, so it is decision D3.

### 3.4 Concurrency default

On the 16 GB, 8-core baseline MemoriaHub yields 4 (`node/runtime-tuning.ts:264-278`, ceiling 4 because each concurrent job holds a decoded image), the platform yields 7 (`runtime-tuning.ts:107-118`). On 32 GB and 16 cores it is 4 versus 15. Image-heavy workers should not take the platform default. Not a platform bug: the platform's executors do not decode images. RETRO-C10 sets `CONCURRENCY` explicitly in its image and compose. If more than one app needs a ceiling, add `createCli({ node: { defaultConcurrencyCeiling } })` later; not needed for G2.

### 3.5 Probes and steps must become async

The synchronous signatures are the structural obstacle for G2.4: `probeCapabilities(): CapabilityProbe` (`capabilities.ts:278`), `runStartupSelfTest(): SelfTestResult` (`:454`), `InstallStep.install(): void` and `runInstallDeps(): InstallDepsReport` (`install-deps.ts:55,166`), and the callers in `start.ts:120-141` and `doctor.ts:101`. HTTP probes (3 to 5 s timeouts), Docker health polling (MemoriaHub retries 20 times at 2 s, `node/install-deps.ts:718`) and model downloads cannot be written against them. Keep the sync built-in binary probe fast and cheap, widen the registered path to `Promise`, and keep a sync wrapper only if an existing caller needs one.

### 3.6 Re-attach identity on migration

Re-attach keys on the node name (`enrollment.ts:156`). MemoriaHub's default is `worker-<host>` (`node/register.ts:64`); the platform's is `<host>` (`node-config.ts:113`). A worker that never set `NODE_NAME` re-registers under a new name after the switch and leaves a stale offline row. The persisted `nodeId` in the config file avoids it only if the platform reads MemoriaHub's config location; the state directory name comes from the app's identity (`paths.ts:54-60`). RETRO-C10 should set `NODE_NAME` (or `NODE_ID`) in its compose and unit files. G2.5 should note it in the runbook; no platform change.

### 3.7 Smaller differences, no action

- MemoriaHub logs a memory line every sample and escalates to `warn` at 0.85 (`node/memory-watchdog.ts:187-203`). The platform logs only when the valve fires. Optional: a periodic info line (G2.2).
- MemoriaHub keeps 2 snapshots, the platform 5; both require 1.5x free disk.
- MemoriaHub's SIGTERM drain on a signal is unbounded, like the platform's. Only the valve drain is bounded in MemoriaHub.
- MemoriaHub's `MEMORIAHUB_HEAP_SNAPSHOT=0` turns off all three snapshot paths; the platform's `HEAP_SNAPSHOTS=false` does the same (`heap-snapshot.ts:71`), but the platform never passes `--heapsnapshot-near-heap-limit`.

## 4. Environment variable mapping

The platform prefix is `envPrefix()` (`identity.ts:251`), derived from the CLI name. For MemoriaHub with CLI name `memoriahub` the prefix is `MEMORIAHUB_`, so a suffix that matches needs no alias.

| MemoriaHub variable | Meaning | Platform key (`worker-env.ts`) | Platform variable | Alias needed |
|---|---|---|---|---|
| `MEMORIAHUB_URL` | API base URL | `serverUrl` (re-exported from `config.ts:158`) | `<PREFIX>SERVER_URL` | **yes** (not in #1072's list) |
| `MEMORIAHUB_TOKEN` | `nod_` credential or PAT | `token` | `<PREFIX>TOKEN` | no |
| `MEMORIAHUB_NODE_ID` | node row to re-attach | `nodeId` | `<PREFIX>NODE_ID` | no |
| `MEMORIAHUB_NODE_NAME` | display name | `nodeName` | `<PREFIX>NODE_NAME` | no |
| `MEMORIAHUB_CONCURRENCY` | job slots | `concurrency` | `<PREFIX>CONCURRENCY` | no (formula differs, section 3.4) |
| `MEMORIAHUB_ELIGIBLE_TYPES` | csv of claimable types | `types` | `<PREFIX>ELIGIBLE_TYPES` | no |
| `MEMORIAHUB_POLL_INTERVAL_MS` | idle poll | `pollMs` | `<PREFIX>POLL_INTERVAL_MS` | no |
| `MEMORIAHUB_HEADLESS` (`1`) | drain on SIGTERM, no deregister | `headless` | `<PREFIX>HEADLESS` | no (platform accepts more spellings) |
| `MEMORIAHUB_STATE_DIR` | state directory | `stateDir` | `<PREFIX>STATE_DIR` | no |
| `MEMORIAHUB_HEAP_TUNED` | re-exec latch | `heapTuned` | `<PREFIX>HEAP_TUNED` | no |
| `MEMORIAHUB_MAX_OLD_SPACE_MB` | heap ceiling, `0` off | `heapLimitMb` | `<PREFIX>HEAP_LIMIT_MB` | **yes**; fix the 8192 clamp (3.2) |
| `MEMORIAHUB_HEAP_RESTART_FRACTION` | valve fraction, `0` off | `memoryThreshold` | `<PREFIX>MEMORY_THRESHOLD` | **yes**, and `0` must mean valve off (3.1) |
| `MEMORIAHUB_HEAP_SNAPSHOT` (`0` off) | all snapshot paths | `heapSnapshots` | `<PREFIX>HEAP_SNAPSHOTS` | **yes** |
| `MEMORIAHUB_MEMWATCH` (`0` off) | watchdog and valve | `memoryWatchdog` | `<PREFIX>MEMORY_WATCHDOG` | **yes** |
| `MEMORIAHUB_SHARP_CONCURRENCY` | libvips threads | none | G2.2 adds `<PREFIX>NATIVE_THREADS` | **yes** (new key) |
| `MEMORIAHUB_STARTUP_SELFTEST` | self-test on or off | none | G2.2 adds `<PREFIX>SELF_TEST` | **yes** (new key) |
| `MODELS_DIR` (no prefix, shared with the API's CLIP path) | model directory | none | G2.4 adds `<PREFIX>MODELS_DIR` | decide; MemoriaHub's API also reads the unprefixed name, so the worker alias keeps one value for both |
| `MEMORIAHUB_FACE_PROVIDER`, `MEMORIAHUB_COMPREFACE_URL` | CompreFace selection and URL | none | none | no: app-side, read by the app's own probe and executor (RETRO-C10) |
| `MEMORIAHUB_CLIP_RECYCLE_AFTER` | CLIP session recycle | none | none | no: app compute concern (out of scope per #1072) |
| `SHARP_FORCE_GLOBAL_LIBVIPS` | build and runtime sharp linking | none | none | no: image-level, set in MemoriaHub's Dockerfile (`Dockerfile:75,154`) |

`MEMORIAHUB_REPO_ROOT`, `MEMORIAHUB_GRADLE_ARGS`, `MEMORIAHUB_KS_*` belong to the Android release tooling, not the worker, and are out of scope.

Value-parsing rules the alias layer must preserve: `MAX_OLD_SPACE_MB` is a non-negative integer used verbatim; `HEAP_RESTART_FRACTION` is a float in `[0, 1]` with out-of-range ignored; `HEAP_SNAPSHOT` and `MEMWATCH` turn off only on `0`; `STARTUP_SELFTEST` accepts `1/true` and `0/false` (`register.ts:47-56`). The platform's `envFlagOn`/`envFlagOff` (`env-flags.ts:16-23`) accept supersets of all of these, so no behaviour is lost by routing through them.

## 5. Exit codes

| Condition | MemoriaHub | Platform |
|---|---|---|
| Clean stop, signal drain | 0 | 0 |
| Unclassified failure, config error | 1 | 1 (`errors.ts:46` `FAILURE`) |
| Bad usage | 1 (commander) | 2 (`USAGE`) |
| Server answered non-2xx | 1 | 3 (`API`) |
| Server unreachable | 1 | 4 (`NETWORK`) |
| Credential rejected | 1 | 5 (`AUTH`) |
| Prerequisite not met | 1 | 6 (`PRECONDITION`) |
| Required capability missing or not operational at startup | 1 (`commands/node.ts:657`) | 70 (`start.ts:73`, `EXIT_MISSING_CAPABILITY`) |
| CompreFace sidecar never healthy | 1 (`commands/node.ts:586`) | not applicable (becomes a failed `service:` probe, exit 70) |
| Memory valve | **75** (`commands/node.ts:139`, `EX_TEMPFAIL`) | **71** (`runtime-tuning.ts:58`, `EXIT_MEMORY_VALVE`) |
| Re-exec shim, child killed by a signal | re-raises the signal (`node/runtime-tuning.ts:~186`) | re-raises the signal (`runtime-tuning.ts:204-211`) |

Both valve codes are non-zero, so every supervisor MemoriaHub uses restarts on either: the compose bundle uses `restart: unless-stopped` (`docker-compose.worker.yml:29,57`) and the unit uses `Restart=on-failure` (`commands/node.ts:1273`). Nothing in MemoriaHub's compose files, unit or docs keys a decision on the number 75; it appears only in prose (`docs/worker-container-config.md:201,225`, `docs/worker-node-setup.md:360`). A configurable exit code (the `memoryValveExitCode` in #1072) is therefore not needed for compatibility; the docs should be updated to say 71. Keep it only if kvox or EvoPath have an external supervisor that keys on a code. See D4.

## 6. Executor mapping for RETRO-C10

Platform keys: `registerNodeExecutor({ type, requiresInput | input, execute })` and `registerJobRequirement(type, { required, degradable })` from `@marinoscar/platform-cli/node`. Capability keys use the `binary:<name>` form today; `module:<name>` and `service:<id>` are what G2.4 adds. "Input" is how the executor reads media: **download** (engine streams to `inputPath`, `requiresInput: true`), **url** (G2.3 `input: 'url'`; today `requiresInput: false` plus `context.api.downloadUrl`), or **none**.

| MemoriaHub executor | Type | Input | Required | Degradable | Other API use | Notes for C10 |
|---|---|---|---|---|---|---|
| `compute/face-detection.ts` | `face_detection` | download | `module:sharp`, `service:compreface` | none | none | CompreFace URL from the app's env; probe is the app's `/status` check |
| `compute/video-face-detection.ts` | `video_face_detection` | download | `module:sharp`, `service:compreface`, `binary:ffmpeg` | none | `api.uploadUrl` for representative-frame thumbnails | thumbnail upload failure per cluster is non-fatal (`video-face-detection.ts` header); also uses ffprobe through `probeVideo` but MemoriaHub does not declare it: add `binary:ffprobe` as required |
| `compute/duplicate-detection.ts` | `duplicate_detection` | download | `module:sharp` | `module:onnxruntime`, model artifact `clip-vit-b32-vision-quantized.onnx` | none | degrades to dHash only without CLIP; model is a G2.4 artifact (hash pinned in `Dockerfile:105-106`); the session-recycle knob stays here |
| `compute/metadata.ts` | `metadata_extraction` | download | `module:sharp` | `binary:ffprobe` | none | MemoriaHub declares only `sharp` (`capabilities.ts:174`) but `probeVideo` runs for video items; declare ffprobe degradable |
| `compute/social-media-detection.ts` | `social_media_detection` | download | `binary:ffprobe` | `module:tesseract`, tessdata artifact, `binary:ffmpeg` | none | Tier 2 OCR needs frames from ffmpeg (`extractFramesAt`); MemoriaHub does not declare ffmpeg. Tier 1 only without tesseract |
| `compute/thumbnail.ts` | `thumbnail_regen` | download | `module:sharp`, `binary:ffmpeg` | none | `api.uploadUrl` for the thumbnail bytes (server chooses the key) | ffmpeg poster-frame fallback ladder lives in the shared compute package |
| `compute/workflow-execute-batch.ts` | `workflow_execute_batch` | none | none | none | none | pure JS declared-intent pass; persist half re-derives everything server-side |
| `compute/auto-tagging.ts` | `auto_tagging` | download | `module:sharp` | none | **provider credential** (`getJobCredentials`) | blocked by platform AI rules; see section 7 and seam #1083 |
| `compute/video-auto-tagging.ts` | `video_auto_tagging` | **url** | `module:sharp`, `binary:ffmpeg`, `binary:ffprobe` | none | **provider credential**, optional second transcription credential | the only URL-mode type (`node-engine.ts:177`); ffmpeg range-seeks the URL; non-faststart MP4 fallback is the executor's job. Blocked like `auto_tagging` |
| `compute/geocode.ts` | `geocode` | none | none | none | **provider credential** for the Google key only | offline and Nominatim providers need no key; only the Google path is blocked (section 7) |

Registration order: `registerNodeExecutor` rejects a type that duplicates a built-in and refuses registration after `createCli` has run (`executors/registry.ts:46-60`), so RETRO-C10 registers all ten before building the CLI. A job type string is permanent once jobs of that type exist, so all ten keep their current names.

## 7. Rejected on purpose, and security

- **Provider API keys on a node.** MemoriaHub's `auto_tagging`, `video_auto_tagging` and `geocode` fetch a transient plaintext key per job through an app-owned `POST /api/nodes/:id/jobs/:jobId/credentials` and call the provider from the node (`compute/auto-tagging.ts:5-21,74`, `compute/geocode.ts:63-92`, `compute/video-auto-tagging.ts:97-110`). The platform rejects this: AI keys never leave the server and `ai.*` job types are permanently server-only (AGENTS.md, AI Platform Rules 2 and 3, enforced by the `ai-jobs-server-only` and `ai-secret-egress` conformance suites). The platform's own `jobSecret` (`executors/index.ts:45`, `node-api.ts:526`) is held in memory for one job and never written; its credential-hygiene check forbids persistence on the node. Seam #1083 asks for an opt-in, off-by-default amendment with a short-lived encrypted node-side cache; it is `needs-decision` and out of scope for G2. Until it is accepted, RETRO-C10 keeps those three types server-only (or ships the other seven first).
- **Model manifest from the server.** MemoriaHub's `GET /api/nodes/models/manifest` lets the server dictate model versions for the fleet. The platform deliberately did not port it (`nodes.service.ts:48-54`, `docs/specs/worker-nodes.md`). G2.4 should provide an app-declared static registry only. Fleet agreement on model versions then comes from the app release, not from a server round trip.
- **Node-supplied `willRetry`.** MemoriaHub sends `willRetry: true` on every failure (`node/node-engine.ts:~520`). The platform accepts the field as advisory and never reads it (`nodes.service.ts:38-47`); the server's attempt budget decides. No change needed.
- **Log redaction.** MemoriaHub redacts by key name only (`node/logger.ts:49`), so a presigned URL inside a message string is logged. The platform also redacts values (`logger.ts:122-151`). Adoption is a security improvement.
- **Credential in `inputUrl`.** MemoriaHub's URL-mode path hands a presigned URL straight to ffmpeg. The platform's redaction applies to engine logs, not to a child process's stderr; the executor must not log the URL (G2.3 docs).

## 8. Scope changes for G2.2 to G2.5

These are the deltas to post as comments on the child issues.

**G2.2 (#1072), runtime gaps. Extend and re-prioritise.**

1. Keep the `registerWorkerRuntimeHook` and `NATIVE_THREADS` design. The reference sharp hook must call both `sharp.cache(false)` and `sharp.concurrency(n)`, and the default must be `min(max(floor(cores/2), 1), 4)` to match MemoriaHub.
2. Alias list: add `MEMORIAHUB_URL` to `SERVER_URL`, and add two new platform keys, `NATIVE_THREADS` and `SELF_TEST`, with aliases for `SHARP_CONCURRENCY` and `STARTUP_SELFTEST`.
3. **New:** alias semantics for `HEAP_RESTART_FRACTION=0` (valve off, sampling on) and for `MAX_OLD_SPACE_MB` above 8192 (section 3.1, 3.2). Without these the aliases are unsafe.
4. **New:** bound the valve drain (default 60 s) in `MemoryWatchdog.fire`, with a test that a never-settling `stop()` still exits.
5. **New, needs D3:** trend window of 30 minutes and 5 samples; optional periodic memory log line with a `warn` at 0.85.
6. **Trim:** `memoryValveExitCode` becomes optional (D4). Keep it only if a consumer needs it, because both codes already trigger every supervisor in use.
7. Parity tests as planned. Add: valve with `MEMORY_WATCHDOG` off is inert; disabled valve with sampling on is inert; drain bounded.
8. **Out, confirmed:** untuned in-process engine tightening (`untunedWatchdogOptions`) and `describeHeapTuning`. The platform has no in-process engine host.

**G2.3 (#1073), URL-input executors. Keep, shrink.**

1. The behaviour is already reachable (`requiresInput: false` plus `context.api.downloadUrl`), so the value is the `input` mode, the `job.download` span attribute, `refreshInputUrl` and the registry validation. MemoriaHub has one consumer, so keep the change small and avoid touching the claim loop.
2. Rate-limit forwarding is confirmed at parity (rows 7); this is a test, not a change.
3. Document in the executor README that the URL is a bearer capability: never log it, never put it in a span attribute (only `job.input_mode = url`).
4. Confirm before coding that `downloadUrl` is allowed for a job whose payload declares no object; the issue's own note says the route already exists.

**G2.4 (#1074), install steps, probes, models. Extend materially.**

1. **New:** make `InstallStep.install`, `runInstallDeps`, `probeCapabilities`, `runStartupSelfTest` and the doctor and start callers async (section 3.5). This is the largest part of the work and should be its first commit.
2. Probe result `installed` for a required key blocks startup; for a degradable key it warns. This preserves MemoriaHub's installed-versus-operational semantics (`capabilities.ts:302-340`, `doctor-summary.ts:51-58`).
3. **New:** refresh cheap presence probes on each heartbeat and keep expensive results cached (row 20).
4. `registerModelArtifact` needs `targetSubdir` (tesseract data lives in `models/tesseract`), treats a present and valid file as `skipped` (the image bakes models), and verifies size and sha256. Resume is not needed; MemoriaHub does not resume.
5. **Drop** the optional server manifest route (section 7). No `packages/platform-api` change in G2.4.
6. Helpers: `ensureAptPackages`, `runWithSudoAnnounced`, `ensureDockerContainer`. The ffmpeg, npm native deps, tesseract and CompreFace specifics are app-side (RETRO-C10).
7. `--only <id,...>` is new; `--dry-run` already exists.

**G2.5, docs, runbook, release. Add.**

1. `docs/runbooks/run-worker-nodes.md` section 6 currently says install-deps ships "as a framework, not as a set of real installs"; update after G2.4. Section 7 should list the alias table and the corrected valve semantics.
2. A migration note for an existing fleet: set `NODE_NAME` explicitly (section 3.6), the valve exit code is 71, `MODELS_DIR`, and the unit file should be regenerated so it gains `--headless` and `TimeoutStopSec`.
3. Update `packages/platform-cli/src/node/README.md` with the new exports and `docs/runbooks/run-worker-nodes.md` section 5 with module and service capability keys.

**RETRO-C10 (MemoriaHub), not in this epic.** Inputs from this report: the executor table in section 6; the three credential-bound executors blocked on #1083; backup hosting stays outside the platform daemon (row 33); `node list` is dropped (row 29); the Ink dashboard, worker Dockerfile, compose bundle and CompreFace steps remain app-side.

## 9. Decisions the maintainers need to make

| ID | Question | Recommendation |
|---|---|---|
| D1 | Disabled valve with sampling on: a new watchdog state, or "valve off means watchdog off"? | New state (`threshold: 0` disables firing only). Vitals and the trend are the useful part of the watchdog |
| D2 | Raise `MAX_HEAP_LIMIT_MB`, or stop clamping an explicit override? | Stop clamping an explicit value (floor 512, ceiling a sane absolute such as 65536); leave the derived default alone |
| D3 | Move the trend window from 10 minutes and 3 samples to 30 minutes and 5? | Yes. It is the platform's own new helper with a single consumer (vitals), and MemoriaHub's #156 analysis shows the short window misreports |
| D4 | Keep `memoryValveExitCode`? | Keep it optional and low priority, default 71, only if a consumer asks. Otherwise decline and fix MemoriaHub's docs |
| D5 | Does C10 wait for #1083 or ship seven executors first? | Ship the seven that need no key; register the three keyed types as server-only until the seam is decided |
| D6 | Should the platform ship a daemon-command hook for apps (backup verbs)? | Not in G2. Raise a seam request only if RETRO-C10 decides backup must share the node daemon |
