import { InternalServerErrorException } from '@nestjs/common';

/**
 * Exception thrown when required database seed data is missing.
 * This indicates the database migrations have been run but seeds have not.
 *
 * A 500 whose envelope `details` carries `missingData`, `seedCommand` and
 * operator `instructions`; the response `code` is `INTERNAL_ERROR` like any
 * other 500 (see {@link HttpExceptionFilter}).
 *
 * @stability stable
 * @example
 * ```ts
 * if (!defaultRole) throw new DatabaseSeedException('default role "Viewer"');
 * ```
 */
export class DatabaseSeedException extends InternalServerErrorException {
  /**
   * @param missingData - What is missing, for the message and `details.missingData`.
   * @param seedCommand - The command that seeds it; defaults to `npm run prisma:seed`.
   */
  constructor(missingData: string, seedCommand = 'npm run prisma:seed') {
    const message = `Database seed data missing: ${missingData}. Please run: ${seedCommand}`;
    super({
      // NOT on the wire. `HttpExceptionFilter` always derives the response's
      // `code` from the HTTP status (500 -> INTERNAL_ERROR) and ignores any
      // `code` on the payload — that is the published contract in
      // `./error.dto.ts`, whose `code` is a closed enum of the
      // status-derived values. Kept here as the internal name for this failure,
      // which is what the log line and `details.missingData` identify it by.
      // Do not add a client that branches on seeing it in a response (#153).
      code: 'DATABASE_SEED_REQUIRED',
      message,
      details: {
        missingData,
        seedCommand,
        instructions: [
          'Database migrations have been run but seed data is missing',
          `Run the following command: ${seedCommand}`,
          'This will populate required data like roles and permissions',
        ],
      },
    });
  }
}
