// =============================================================================
// What `GET /api/admin/doctor` answers with (issue #634)
// =============================================================================
//
// The schemas and their types live in `@marinoscar/platform-contract/doctor`
// (#701), shared with the web client; this file only wraps the report schema
// as the nestjs-zod DTO the controller names in its OpenAPI response.
// =============================================================================

import { doctorReportSchema } from '@marinoscar/platform-contract/doctor';
import { createZodDto } from 'nestjs-zod';

/**
 * The OpenAPI response DTO of `GET /api/admin/doctor`: the nestjs-zod DTO of
 * `doctorReportSchema` from `@marinoscar/platform-contract/doctor`.
 *
 * @stability stable
 */
export class DoctorReportDto extends createZodDto(doctorReportSchema) {}
