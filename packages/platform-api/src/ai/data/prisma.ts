// =============================================================================
// `Prisma`, as the AI slice uses it, without a generated client (issue #739)
// =============================================================================
//
// The moved AI code spelled its JSON types, its select payloads and its raw
// SQL through the generated client's `Prisma` namespace. A package cannot
// import that (test/no-generated-client.spec.ts), so this file gives the same
// spellings structurally: the raw-SQL builders come from
// `@prisma/client-runtime-utils`, the non-generated runtime the app's own
// client loads (its `Prisma.sql` IS this `sql`, so a fragment built here nests
// in the app's `$queryRaw`), and every model type is the row of `./ai-db.ts`.
// Internal to the slice: never exported.
// =============================================================================

import { Sql as RuntimeSql, join, raw, sql } from '@prisma/client-runtime-utils';

import type { AiInputJsonValue, AiJsonValue, AiModelRow, AiRunRow, UserAiKeyRow } from './ai-db';

/** The raw-SQL builders, under the names `Prisma.sql` / `.raw` / `.join`. */
export const Prisma = Object.freeze({ sql, raw, join });

/** The type half of `Prisma`: JSON values, select payloads and inputs, structurally. */
// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace Prisma {
  /** A JSON value a write accepts. */
  type InputJsonValue = AiInputJsonValue;
  /** A JSON column's value. */
  type JsonValue = AiJsonValue;
  /** A raw-SQL fragment. */
  type Sql = RuntimeSql;
  /** An `ai_models` select (checked by the app's client at run time). */
  type AiModelSelect = { [K in keyof AiModelRow]?: boolean };
  /** An `ai_models` filter. */
  type AiModelWhereInput = { [field: string]: unknown };
  /** An `ai_models` update. */
  type AiModelUpdateInput = { [field: string]: unknown };
  /** One `ai_models` row to insert. */
  type AiModelCreateManyInput = Partial<Omit<AiModelRow, 'capabilities'>> & {
    provider: string;
    modelId: string;
    capabilities: AiInputJsonValue;
  };
  /** An `ai_models` row read with a select: typed as the whole row. */
  type AiModelGetPayload<_T> = AiModelRow;
  /** An `ai_runs` select. */
  type AiRunSelect = { [K in keyof AiRunRow]?: boolean };
  /** An `ai_runs` row read with a select: typed as the whole row. */
  type AiRunGetPayload<_T> = AiRunRow;
  /** A `user_ai_keys` select. */
  type UserAiKeySelect = { [K in keyof UserAiKeyRow]?: boolean };
  /** A `user_ai_keys` row read with a select: typed as the whole row. */
  type UserAiKeyGetPayload<_T> = UserAiKeyRow;
  /** A `user_ai_keys` `updateMany` data. */
  type UserAiKeyUpdateManyMutationInput = { [K in keyof UserAiKeyRow]?: unknown };
}
