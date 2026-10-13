// =============================================================================
// Example access rule: "nobody but the owner reaches a frozen record" (PP-14.16)
// =============================================================================
//
// Extension point: `registerAccessRule`, the DENY side.
//
// A rule that denies wins over every grant, group membership and the
// organization default. The record's user owner and a holder of the action's
// bypass permission are decided before the rules, so a freeze can never lock an
// owner or an administrator out. A rule that can deny declares `mayDeny` and
// MUST give SQL, so "resources I can see" hides what `decide` denies;
// `describeAccessRuleConformance` compares the two.
//
// The condition is never NULL on purpose (`frozen_at IS NOT NULL`): a NULL
// deny condition would hide the record from the list (`NOT NULL` is not true)
// while the decision abstains.
//
// Proof: apps/api/test/examples/sharing/project-member.example.db.spec.ts.
// =============================================================================

import type { AccessRuleDef } from '@marinoscar/platform-api/sharing';
import { Prisma } from '@prisma/client';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Where the rule finds the freeze flag.
 *
 * @stability experimental
 */
export interface FrozenRecordRuleConfig {
  /** The resource type the rule applies to. */
  resourceType: string;
  /** The table of the records: `id`, `org_id` and the freeze column. */
  table: string;
  /** A nullable timestamp column: set means frozen. Default `frozen_at`. */
  column?: string;
  /** The rule's id. Default `frozen-record`. */
  id?: string;
}

function identifier(value: string, what: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`createFrozenRecordAccessRule: ${what} must be a plain identifier, not ${JSON.stringify(value)}`);
  return value;
}

/**
 * Builds the frozen-record rule for one resource type.
 *
 * @param config - the resource type and its table.
 * @returns the rule, ready for `registerAccessRule`.
 * @throws Error when a table or column name is not a plain identifier.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function createFrozenRecordAccessRule(config: FrozenRecordRuleConfig): AccessRuleDef {
  const table = Prisma.raw(`"${identifier(config.table, 'table')}"`);
  const column = identifier(config.column ?? 'frozen_at', 'column');
  const columnSql = Prisma.raw(`"${column}"`);

  return {
    id: config.id ?? 'frozen-record',
    position: 'before-grants',
    resourceTypes: [config.resourceType],
    mayDeny: true,

    async evaluate(ctx) {
      const rows = await (ctx.tx as Prisma.TransactionClient).$queryRaw<Array<{ frozen: boolean }>>`
        SELECT (${columnSql} IS NOT NULL) AS frozen FROM ${table}
        WHERE id = ${ctx.resource.id}::uuid AND org_id = ${ctx.resource.orgId}::uuid`;
      return rows[0]?.frozen === true ? 'deny' : 'abstain';
    },

    sql: (ctx) => ({ deny: ctx.kit.sql`${ctx.column(column)} IS NOT NULL` }),
  };
}
