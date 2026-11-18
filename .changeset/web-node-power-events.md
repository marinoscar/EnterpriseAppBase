---
"@marinoscar/platform-web": minor
---

Worker Nodes page: a power badge per node (AC or battery with percent and charging state), a "Host machine" section in the vitals dialog (host CPU, memory, load, OS, power) and a paginated node events timeline backed by `useNodeEvents` / `NodesApi.listNodeEvents`. The telemetry metric table now renders 0/1 status gauges. Apps with their own `NodesApi` implementation must add `listNodeEvents`.
