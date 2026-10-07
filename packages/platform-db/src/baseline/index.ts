export { createBaselineDeps, type BaselineDepsOptions } from './deps.js';
export { BaselineError, type BaselineErrorCode } from './errors.js';
export { proposeMapping, type MatchKind, type MatchedMigration } from './mapping.js';
export { normaliseSql, normalisedSha256, normaliseStatement, splitStatements } from './normalise.js';
export { planBaseline, type PlannedAction, type PlannedEntry } from './plan.js';
export { isBaselineClean, renderReport, type BaselineRefusal, type BaselineReport } from './report.js';
export {
  readOperatorMap,
  resolveThrough,
  runBaseline,
  type BaselineDeps,
  type BaselineOptions,
  type PrismaResult,
} from './run.js';
