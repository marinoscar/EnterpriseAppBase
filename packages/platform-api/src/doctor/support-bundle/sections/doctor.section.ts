// The `doctor` support-bundle section (issue #772): the full Doctor report,
// unchanged. Built in; registered by `DoctorModule.forRoot()`.
//
// `run({ refresh: false })` reads the Doctor's report cache (15 s by default),
// so downloading a bundle never multiplies probes. The report is passed
// through as is: every check already obeys rule 4 of the check contract (no
// secret material in `detail`, `error` or `data`), and the central redaction
// pass runs over it anyway.

import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { DOCTOR_STATUSES } from '../../doctor-check.interface';
import { DoctorService } from '../../doctor.service';
import type { SupportBundleSection } from '../support-bundle-section.interface';
import { SupportBundleRegistry } from '../support-bundle.registry';

const status = z.enum(DOCTOR_STATUSES);

/** The report row, field for field, strict: a new field must be allowed here first. */
const doctorSectionCheckSchema = z
  .object({
    id: z.string(),
    category: z.string(),
    label: z.string(),
    settingsPath: z.string().nullable(),
    status,
    detail: z.string(),
    remedy: z.string().nullable(),
    error: z.string().nullable(),
    data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable(),
    durationMs: z.number(),
  })
  .strict();

const doctorSectionSchema = z
  .object({
    verdict: status,
    generatedAt: z.string(),
    durationMs: z.number(),
    checks: z.array(doctorSectionCheckSchema),
  })
  .strict();

/**
 * The `doctor` section's data: the Doctor report.
 *
 * @stability experimental
 */
export type DoctorSupportBundleData = z.infer<typeof doctorSectionSchema>;

/**
 * The built-in `doctor` section: the full, cached Doctor report.
 *
 * @stability experimental
 */
@Injectable()
export class DoctorSupportBundleSection implements SupportBundleSection<DoctorSupportBundleData>, OnModuleInit {
  readonly id = 'doctor';
  readonly label = 'Doctor report';
  readonly schema = doctorSectionSchema;

  constructor(
    @Inject(SupportBundleRegistry) private readonly registry: SupportBundleRegistry,
    @Inject(DoctorService) private readonly doctor: DoctorService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async collect(): Promise<DoctorSupportBundleData> {
    return this.doctor.run({ refresh: false });
  }
}
