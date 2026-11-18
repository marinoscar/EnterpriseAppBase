---
"@marinoscar/platform-api": minor
---

Add `@marinoscar/platform-api/jobs` and `/nodes` (#734): the background job queue (`JobsModule.forRoot()`, the handler contract and registry, the job-type label registry `registerJobTypeLabel`, `JobScope.run`, `enqueueHousekeepingJob`, `job.settled`, `org_id` on enqueued jobs and as the `org.id` span attribute, an `orgId` filter on `GET /api/admin/jobs`) and the worker-node fleet (`NodesModule.forRoot()`, `NodeCredentialModule`, the node control and data planes through the `NODE_OBJECT_STORE` port, the brokered per-job secret, the `nodes.node.offline` event). Moved from the reference app with unchanged routes, permissions and environment variables; `JOB_TYPE_LABELS` is replaced by a `label` on each handler. A cron-enqueue-only exemption may now pin the source `root` it lives under.
