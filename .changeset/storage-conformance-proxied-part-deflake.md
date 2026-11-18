---
"@marinoscar/platform-api": patch
---

Make the storage driver conformance kit's `proxiedPart` check deterministic (#1204). It sampled external memory right after a forced collection, but V8 frees a Buffer's backing store on a concurrent sweeper, so under CPU load a driver that streams correctly could still read above the budget and fail. Each sample now yields to the event loop between collections and keeps the lowest of a few readings; a driver that buffers the part still fails the check.
