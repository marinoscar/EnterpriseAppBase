// =============================================================================
// What `GET admin/db-backup/node-credential-preflight` answers with
// (issue #350, epic #345)
// =============================================================================
//
// ONE QUESTION: can this deployment hand a worker node a short-lived,
// SELECT-only credential to its own database, so that a `db.backup.run` job can
// be executed somewhere other than the API process?
//
// -----------------------------------------------------------------------------
// ⚠ `guided` IS A 200, AND INVENTING A STATUS CODE FOR IT WOULD BE THE BUG
// -----------------------------------------------------------------------------
//
// This is the third place in this subsystem to make the same argument, and it
// is the same argument every time (`db-backup.controller.ts`'s header for the
// restore pair; `docs/specs/database-restore.md` for the `CREATEDB` gate):
// managed PostgreSQL withholding `CREATEROLE` from an application role is the
// ORDINARY configuration, not a fault. A 4xx here would tell an administrator
// their platform is unsupported when it is not, and a 5xx would tell them
// something is broken when nothing is. What is true is smaller and more useful:
// node offload needs two lines of SQL they have not run, and if they choose not
// to run them the API keeps taking its own backups exactly as before.
//
// So the STATUS is always 200 and the ANSWER is `outcome`, with the SQL in
// `guidance.commands` — real role names, ready to paste. A block with a
// placeholder in it is not a deliverable, it is homework.
//
// -----------------------------------------------------------------------------
// WHY `brokerEnabled` IS A SEPARATE FIELD FROM `outcome`
// -----------------------------------------------------------------------------
//
// They are different facts and conflating them would be actively misleading.
// `outcome` is a CAPABILITY — whether this deployment's database role CAN mint.
// `brokerEnabled` is a POLICY — whether an administrator has decided its fleet
// is inside the trust boundary (`nodes.jobSecretBrokerEnabled`, default OFF).
//
// An operator can face any combination, and each needs a different next step: a
// capable deployment with the policy off is one toggle away; an enabled policy
// on a role without `CREATEROLE` needs the `GRANT` below and nothing else; both
// off need both. Folding them into one verdict would send half of those people
// to the wrong screen.
// =============================================================================

import { createZodDto } from 'nestjs-zod';

import {
  nodeCredentialPreflightSchema,
} from '@marinoscar/platform-contract/db-backup';

// The wire shapes live in `@marinoscar/platform-contract/db-backup` (#740);
// re-exported so every importer of this file keeps its import.
export {
  NODE_CREDENTIAL_PREFLIGHT_OUTCOMES,
  guidedJobRoleInstructionsSchema,
  nodeCredentialPreflightSchema,
} from '@marinoscar/platform-contract/db-backup';
/** @stability experimental */
export type {
  NodeCredentialPreflight,
} from '@marinoscar/platform-contract/db-backup';

/** @stability experimental */
export class NodeCredentialPreflightDto extends createZodDto(nodeCredentialPreflightSchema) {}

