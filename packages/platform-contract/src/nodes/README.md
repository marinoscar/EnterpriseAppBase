# @marinoscar/platform-contract/nodes

The node routes' request shapes (issue #734, PP-8.2), as zod schemas with their inferred types, plus the zod-free node bounds. `@marinoscar/platform-api/nodes` wraps every schema with `createZodDto`; the node runner of `@marinoscar/platform-cli` sends exactly these bodies. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One definition of what a worker node may send: the control plane (`registerNodeSchema`, `heartbeatNodeSchema` with its closed `nodeVitalsSchema`, `claimJobsSchema`, `renewLeaseSchema`, `nodeJobResultSchema`, `nodeJobFailureSchema`), the data plane's two URL mints (`nodeDownloadUrlSchema`, `nodeUploadUrlSchema`), the per-job secret request (`nodeJobSecretRequestSchema`), the shared `claimTokenField`, and the node credential mint (`createNodeCredentialSchema`). `constants.ts` holds `MAX_NODE_CONCURRENCY`, `MAX_NODE_ELIGIBLE_TYPES` and `MAX_NODE_CREDENTIAL_DAYS`, zod-free.

Not here: the responses, which stay Swagger classes in the API slice, and the node runner.

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { heartbeatNodeSchema, MAX_NODE_CONCURRENCY } from '@marinoscar/platform-contract/nodes';
import type { NodeVitals } from '@marinoscar/platform-contract/nodes';
```

None beyond the package's own peer, `zod` (`^4.4.3`).

## Quick start

The API slice's heartbeat DTO wraps the schema ([`nodes.integration.spec.ts`](../../../../apps/api/test/nodes/nodes.integration.spec.ts) posts it):

```ts
import { createZodDto } from 'nestjs-zod';
import { heartbeatNodeSchema } from '@marinoscar/platform-contract/nodes';

export class HeartbeatNodeDto extends createZodDto(heartbeatNodeSchema) {}
```

## Configuration

None. Schemas and constants take no options.

## Extension-point catalog

None. The node protocol is the platform's; a node that learns a new vital needs a contract change first, which is the review that surface should get.

Supporting exports (experimental unless tagged stable): the constants above, every `*Schema` of `schemas.ts` and of `settings-schemas.ts` (stable), `claimTokenField`, the inferred types `NodeVitals` and `NodeVitalsCounters`, and the enum entry type `NodeReportedStatusEnum`.

## Data

No tables. The vitals are stored verbatim in `worker_nodes.last_vitals` (the `jobs` fragment of `@marinoscar/platform-db`), which is why `nodeVitalsSchema` is `.strict()` and every value bounded.

## Permissions and settings

None declared here. The control plane authenticates the node's `nod_` credential; the credential mint requires `nodes:write` (`@marinoscar/platform-api/nodes`). The `nodes` system-settings namespace's schemas are here (`settings-schemas.ts`, #865): `systemNodesSchema`, `systemNodesPatchSchema`, `nodesSettingsSchema`, `nodesSettingsPatchSchema`, `nodesResponseSchema`, with `SystemNodesValue` and `NodesSettingsPatchInput`; its declaration is `NODES_SYSTEM_SETTINGS` of `@marinoscar/platform-api/nodes`.

## UI

None.

## Infra

None.

## Observability

None. The package emits nothing at run time.

## Security notes

Every node-supplied value is bounded: a node is a machine the deployment may not own. `claimTokenField` is a UUID quoting back which claim is asking; the server's allowlists, not these schemas, are the authority on which fields may be sent (an unknown field is refused by name there).

## Conformance suite

None of its own. `test/jobs-nodes.test.ts` parses representative bodies; the API slice's node specs exercise the DTOs end to end.

## Upgrade notes

New in this version: the request schemas moved here from `@marinoscar/platform-api/nodes`'s `dto/` files, unchanged. The API still re-exports them under the same names.

#865: the `nodes` settings namespace's five schemas moved here from the reference app's `common/schemas/` files, unchanged (the app re-exports them under the same names).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every heartbeat is a 400 after a node upgrade | The node reports a vital the schema does not list (`.strict()`) | Upgrade the API first; vitals are a closed contract |

## Links

- [Package README](../../README.md)
- [The API slice](../../../platform-api/src/nodes/README.md)
- [Contract conventions](../../../../docs/PACKAGES.md#contract-conventions)
