# Job Handlers (moved)

The "add a job type" recipe moved with the queue into the jobs slice of
`@marinoscar/platform-api` (#734):
[`packages/platform-api/src/jobs/handlers/README.md`](../../../../../packages/platform-api/src/jobs/handlers/README.md).

The reference app's worked examples (`example.echo`, server-only;
`example.checksum`, node-eligible; a label for a handler-less type) are in
[`../../examples/jobs/`](../../examples/jobs/). Node result schemas of the
app's own job types stay in [`../contracts/`](../contracts/README.md).
