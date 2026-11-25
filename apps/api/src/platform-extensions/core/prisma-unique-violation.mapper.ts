import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ErrorCodeDef, ErrorMapper } from '@marinoscar/platform-api/core';

// =============================================================================
// EXAMPLE: an error mapper for a foreign error (PP-14.14)
// =============================================================================
//
// A Prisma unique-constraint violation (`P2002`) is not an `HttpException`, so
// today it surfaces as a 500. A mapper turns it into the 409 the caller can act
// on:
//
//     PlatformHostCoreModule.forRoot({ errorMappers: APP_ERROR_MAPPERS })
//
// The mapper builds the response itself and NEVER copies the Prisma message
// (`Unique constraint failed on the fields: (`email`)` names columns, and a
// driver error can name hosts and values). The original error is logged
// server-side by the filter. Mappers see only values that are not already an
// `HttpException`, so they cannot rewrite a built-in response.
//
// Not wired into `platform/host-core.config.ts`: it would change today's 500 for
// an unhandled `P2002` into a 409. A fork that wants it passes the array there.
// Recipe: docs/EXTENDING.md, "Add an error mapper".
// =============================================================================

/** The code the mapper answers with. */
export const RESOURCE_ALREADY_EXISTS = 'RESOURCE_ALREADY_EXISTS' as const;

/** The registration `app-registrations/core.ts` makes. */
export const resourceAlreadyExistsCode: ErrorCodeDef = {
  code: RESOURCE_ALREADY_EXISTS,
  status: 409,
  description: 'The resource violates a uniqueness rule (a record with the same unique value exists).',
};

/** `P2002` becomes `409 RESOURCE_ALREADY_EXISTS`; every other error passes. */
export const prismaUniqueViolationMapper: ErrorMapper = (error) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
    ? new ConflictException({ code: RESOURCE_ALREADY_EXISTS, message: 'A record with the same unique value already exists' })
    : null;
