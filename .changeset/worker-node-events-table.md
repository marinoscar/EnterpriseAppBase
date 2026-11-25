---
"@marinoscar/platform-db": patch
---

Add the `worker_node_events` table (`WorkerNodeEvent`, jobs/nodes slice, #1045): events a worker node reports about itself, with an open `type`, a `severity`, optional JSON `attrs`, the node's `occurred_at` and the server's `received_at`. Cascades with `worker_nodes`; no row-level security. Migration `0038_add_worker_node_events`; apply it with `npm run db:sync`, then `prisma:migrate`.
