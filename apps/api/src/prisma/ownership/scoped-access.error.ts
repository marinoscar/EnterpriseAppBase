/**
 * Thrown by a user-scoped Prisma client when a call would step outside its
 * scope: a model that is not user-owned, raw SQL, or a write naming another
 * owner.
 *
 * A programming error, not a client error: it is deliberately not an
 * `HttpException`, so a request that reaches it fails as a 500 and the log
 * names the model. A row owned by someone else is never reported this way;
 * reads and writes on it behave as "not found".
 *
 * @stability experimental
 */
export class ScopedAccessError extends Error {
  /** The Prisma model involved, when there is one. */
  readonly model?: string;
  /** The Prisma operation involved, e.g. `'findMany'` or `'$queryRaw'`. */
  readonly operation?: string;

  constructor(message: string, details: { model?: string; operation?: string } = {}) {
    super(message);
    this.name = 'ScopedAccessError';
    if (details.model !== undefined) this.model = details.model;
    if (details.operation !== undefined) this.operation = details.operation;
  }
}
