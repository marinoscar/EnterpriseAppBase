---
"@marinoscar/platform-cli": minor
---

Node executors can declare `input: 'url'`. The engine then hands the executor a fresh presigned URL (`context.inputUrl`, with `context.input` metadata and `context.refreshInputUrl()`, single-flight, re-requested within 60 s of expiry) and downloads nothing, for tools that range-seek the object such as ffmpeg and ffprobe. `input` is `'none' | 'download' | 'url'`; `requiresInput` stays as the older spelling of `'download'`/`'none'`, and an executor must declare exactly one of the two. `JobExecutionContext` gains `inputUrl` and `refreshInputUrl`, and the `job.download` span carries `inputMode`. `checkExecutorCredentialHygiene` now also flags a signed input URL that is logged, returned or put in an error. Adds `resolveInputMode` and the `JobInputMode` type, and a test pinning that a `ProviderRateLimitError` (429/529, with or without a retry-after) is forwarded as a deferral.
