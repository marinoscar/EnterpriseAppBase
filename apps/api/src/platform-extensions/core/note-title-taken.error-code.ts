import { ConflictException } from '@nestjs/common';
import type { ErrorCodeDef } from '@marinoscar/platform-api/core';

// =============================================================================
// EXAMPLE: an app's own error code (PP-14.14)
// =============================================================================
//
// `code` in the error envelope is `CONFLICT` for any 409. A client that must tell
// "this title is taken" from "the version moved" branches on a DOMAIN code the
// app registered for that status:
//
//     registerErrorCode({ code: 'NOTE_TITLE_TAKEN', status: 409, ... })   // app-registrations/core.ts
//     throw new NoteTitleTakenException('Quarterly review');
//
// The filter passes a payload `code` through ONLY when it is registered for the
// exception's own status; a typo, an unregistered code or a code on the wrong
// status falls back to the status-derived one, so the envelope never carries a
// code the API docs do not list (the OpenAPI `ErrorDto.code` examples are the
// registry). Machine-readable data still goes under `details`.
// Recipe: docs/EXTENDING.md, "Add an error code".
// =============================================================================

/** The code. */
export const NOTE_TITLE_TAKEN = 'NOTE_TITLE_TAKEN' as const;

/** The registration `app-registrations/core.ts` makes. */
export const noteTitleTakenCode: ErrorCodeDef = {
  code: NOTE_TITLE_TAKEN,
  status: 409,
  description: 'A note with this title already exists in the organization.',
};

/** A 409 carrying {@link NOTE_TITLE_TAKEN}. */
export class NoteTitleTakenException extends ConflictException {
  constructor(title: string) {
    super({ code: NOTE_TITLE_TAKEN, message: 'A note with this title already exists', details: { field: 'title', title } });
  }
}
