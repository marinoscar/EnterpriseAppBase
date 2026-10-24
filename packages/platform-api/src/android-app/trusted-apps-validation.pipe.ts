import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import {
  TRUSTED_APPS_ERROR_REASONS,
  updateAndroidAppSchema,
  type TrustedAppsErrorReason,
  type UpdateAndroidAppInput,
} from '@marinoscar/platform-contract/android-app';

// MemoriaHub's typed validation of `PUT /api/admin/android-app`: the 400
// carries `details.reason` (the first problem by priority) and every issue
// under `details.issues`, so a client can say WHICH entry is wrong.

const REASON_PRIORITY: readonly TrustedAppsErrorReason[] = [
  TRUSTED_APPS_ERROR_REASONS.TOO_MANY_TRUSTED_APPS,
  TRUSTED_APPS_ERROR_REASONS.INVALID_PACKAGE_NAME,
  TRUSTED_APPS_ERROR_REASONS.INVALID_FINGERPRINT,
  TRUSTED_APPS_ERROR_REASONS.INVALID_TRUSTED_APPS,
];

/**
 * The typed reason of one zod issue of the trusted-apps body.
 *
 * @param issue - one issue.
 * @returns its reason.
 *
 * @stability experimental
 */
export function reasonForIssue(issue: z.core.$ZodIssue): TrustedAppsErrorReason {
  const [root, index, field] = issue.path;
  if (root === 'trustedApps' && issue.path.length === 1 && issue.code === 'too_big') {
    return TRUSTED_APPS_ERROR_REASONS.TOO_MANY_TRUSTED_APPS;
  }
  if (root === 'trustedApps' && typeof index === 'number') {
    if (field === 'packageName') return TRUSTED_APPS_ERROR_REASONS.INVALID_PACKAGE_NAME;
    if (field === 'sha256') return TRUSTED_APPS_ERROR_REASONS.INVALID_FINGERPRINT;
  }
  return TRUSTED_APPS_ERROR_REASONS.INVALID_TRUSTED_APPS;
}

/**
 * Validates and normalises the trusted-apps body; a refusal is a 400 with a
 * typed `details.reason`.
 *
 * @stability experimental
 */
@Injectable()
export class TrustedAppsValidationPipe implements PipeTransform<unknown, UpdateAndroidAppInput> {
  /**
   * Parses the body.
   *
   * @param value - the raw body.
   * @returns the parsed, normalised, deduplicated list.
   * @throws BadRequestException with `details.reason` and `details.issues`.
   */
  transform(value: unknown): UpdateAndroidAppInput {
    const parsed = updateAndroidAppSchema.safeParse(value ?? {});
    if (parsed.success) return parsed.data;
    const reasons = new Set(parsed.error.issues.map(reasonForIssue));
    const reason = REASON_PRIORITY.find((candidate) => reasons.has(candidate))!;
    throw new BadRequestException({
      message: 'Invalid trusted Android apps',
      details: {
        reason,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          reason: reasonForIssue(issue),
          message: issue.message,
        })),
      },
    });
  }
}
