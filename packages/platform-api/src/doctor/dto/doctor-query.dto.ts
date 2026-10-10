import { doctorQuerySchema } from '@marinoscar/platform-contract/doctor';
import { createZodDto } from 'nestjs-zod';

/**
 * The validated query of `GET /api/admin/doctor`: the nestjs-zod DTO of
 * `doctorQuerySchema` from `@marinoscar/platform-contract/doctor` (#701), where
 * the schema and its parsed type `DoctorQuery` live.
 *
 * @stability stable
 */
export class DoctorQueryDto extends createZodDto(doctorQuerySchema) {}
