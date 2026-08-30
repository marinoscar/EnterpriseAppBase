import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_EMAIL_SETTINGS,
  EmailSettings,
  emailSettingsSchema,
} from './email-settings.schema';

// =============================================================================
// EmailSettingsService — where email configuration is read from (issue #122)
// =============================================================================
//
// WHERE THESE SETTINGS LIVE, AND WHY
//
// In the existing `system_settings` table, as epic #109 and issue #122 call
// for — but in a row of its OWN, under key 'email', NOT inside the 'global'
// row's blob. No new table, no migration; `system_settings.key` is already
// `@unique` and the table is already keyed for exactly this.
//
// The reason it is not inside the 'global' blob is not taste, it is that the
// blob would eat it. `SystemSettingsService` rebuilds that value field by
// field on every write:
//
//   • replaceSettings (PUT)  → `systemSettingsSchema.parse(dto)`, and zod
//                              STRIPS unknown keys, so anything not in that
//                              schema is dropped from the stored object.
//   • patchSettings (PATCH)  → hand-builds `merged` as `{ ui, features }`,
//                              which discards every other key even on a
//                              partial update.
//
// So an `email` key inside the 'global' blob would be silently destroyed the
// next time an admin saved an unrelated general setting — mail stops working,
// nothing in the audit trail explains why, and the admin's action ("I toggled
// a feature flag") has no visible connection to the outcome ("email is
// unconfigured"). Widening `systemSettingsSchema` does not fix it: a PUT whose
// DTO omits `email` still stores an object without it.
//
// A separate row makes that impossible: the two settings surfaces write
// different rows, and neither can clobber the other. It also keeps SMTP host
// and username out of `GET /api/system-settings`' response, which is a smaller
// blast radius for no extra cost, and it gives #124's page its own version
// counter for optimistic concurrency instead of sharing one with a page that
// has nothing to do with email.
//
// #124 owns the WRITE path and adds it here, next to this read, so both halves
// of "what is the email configuration" stay in one file.
// =============================================================================

/**
 * The `system_settings.key` this configuration is stored under.
 *
 * Exported so #124's write path and any test fixture address the same row by
 * the same constant rather than by a repeated string literal.
 */
export const EMAIL_SETTINGS_KEY = 'email';

@Injectable()
export class EmailSettingsService {
  private readonly logger = new Logger(EmailSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read the current email configuration.
   *
   * @returns validated settings; {@link DEFAULT_EMAIL_SETTINGS} when nothing
   *          has been configured yet.
   * @throws if a row exists but does not validate (see below). Callers inside
   *         a provider are safe: `BaseEmailProvider.send` turns this into a
   *         `{ success: false, error }`, which is how an admin gets told.
   */
  async get(): Promise<EmailSettings> {
    const row = await this.prisma.systemSettings.findUnique({
      where: { key: EMAIL_SETTINGS_KEY },
      select: { value: true },
    });

    if (!row) {
      // Absent is NOT an error: a fresh install has no email configuration and
      // that is a normal, expected state. Callers see "no provider selected"
      // and report it as such.
      return DEFAULT_EMAIL_SETTINGS;
    }

    const parsed = emailSettingsSchema.safeParse(row.value);

    if (!parsed.success) {
      // THROW, DO NOT FALL BACK TO DEFAULTS. Silently substituting defaults
      // for a stored-but-invalid configuration reports the system as "email
      // not configured" when what actually happened is that a hand-edited row,
      // a bad migration, or an older schema left something unreadable. That is
      // the same silent-disablement failure CredentialsService refuses on a
      // decrypt error, for the same reason: a configuration problem has to be
      // visible to the person who can fix it.
      //
      // FIELD PATHS ONLY, NEVER VALUES. No secret is in this schema by
      // construction, but an error message that echoes stored configuration is
      // a habit that stops being safe the moment the schema grows. `zod`'s own
      // `message` strings can quote the received value, so only `path` is used.
      const paths = parsed.error.issues
        .map((issue) => issue.path.join('.') || '(root)')
        .join(', ');

      this.logger.error(
        `Stored email settings are invalid at: ${paths}. Email is unusable until they are saved again.`,
      );

      throw new Error(
        `Stored email settings are invalid at: ${paths}. Re-save the email configuration.`,
      );
    }

    return parsed.data;
  }
}
