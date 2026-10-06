import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * `GET /api/admin/doctor` query.
 *
 * `refresh` is `z.enum(['true','false']).transform(...)` and NOT
 * `z.coerce.boolean()`, for the reason the app's `jobs/dto/job-list-query.dto.ts`
 * gives: every query parameter is a string and `Boolean('false')` is `true`.
 *
 * @stability stable
 */
export const doctorQuerySchema = z.object({
  /** Only the checks in this category (plus, unreported, whatever they depend on). */
  category: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'category must be a lowercase identifier')
    .optional(),
  /** `true` bypasses the 15-second report cache. */
  refresh: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

/**
 * The validated query of `GET /api/admin/doctor` (the nestjs-zod DTO of the query schema).
 *
 * @stability stable
 */
export class DoctorQueryDto extends createZodDto(doctorQuerySchema) {}

/**
 * The parsed query.
 *
 * @stability stable
 */
export interface DoctorQuery {
  /** Only the checks in this category (a lowercase identifier). */
  category?: string;
  /** `true` bypasses the report cache. */
  refresh?: boolean;
}

// Compile-time proof that the interface above IS the schema's output type.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const queryMatchesSchema: Same<DoctorQuery, z.output<typeof doctorQuerySchema>> = true;
void queryMatchesSchema;
