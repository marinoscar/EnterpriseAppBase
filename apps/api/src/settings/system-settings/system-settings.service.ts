import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateSystemSettingsDto } from '../dto/update-system-settings.dto';
import { PatchSystemSettingsDto } from '../dto/update-system-settings.dto';
import {
  DEFAULT_SYSTEM_SETTINGS,
  SystemSettingsValue,
} from '../../common/types/settings.types';
import {
  SystemSettingsDto,
  systemSettingsSchema,
} from '../../common/schemas/settings.schema';

const SETTINGS_KEY = 'global';

// =============================================================================
// SystemSettingsService — the 'global' system_settings row (#130)
// =============================================================================
//
// THE RULE THIS SERVICE NOW ENFORCES, IN ONE LINE:
//   request bodies stay CLOSED; the stored value is never NARROWED.
//
// Two different things used to be conflated, and conflating them is what made
// this row a trap:
//
//   • What a caller is allowed to SEND. Still strictly validated, still
//     unknown-key-stripping, at both the DTO layer (`createZodDto` +
//     nestjs-zod's pipe) and again here via `systemSettingsSchema.parse`. No
//     new write surface is opened by this file: an admin cannot smuggle an
//     arbitrary blob into `system_settings` through PUT or PATCH.
//
//   • What is already STORED. Carried forward verbatim. A key we do not
//     recognise got into that row through some path we trust — a seed, a
//     migration, a newer build of this same service — and "this version of the
//     code does not know what that is" has never been a good reason to delete
//     someone's data.
//
// WHAT WAS BROKEN (both write paths, independently):
//
//   • replaceSettings (PUT)  → `systemSettingsSchema.parse(dto)` and store the
//     result. Zod strips unknown keys, so every key outside `{ ui, features }`
//     vanished from the row.
//   • patchSettings (PATCH)  → hand-built `merged` as literally
//     `{ ui: {...}, features: {...} }`, copying two named keys out of the
//     current value and discarding the rest — on a PARTIAL update, where the
//     caller had asked to change one feature flag and nothing else.
//
// Neither produced an error, a log line, or an audit entry. The admin's action
// ("I toggled a flag") had no visible connection to the outcome ("the thing
// that key configured is now unconfigured").
//
// WHY PRESERVE RATHER THAN REJECT. The alternative on the table was to fail
// the save when the stored value carries an unknown key. It is cheaper, and it
// does convert a silent trap into an error — but it puts the error on the
// wrong person at the worst time. The admin who typed nothing wrong gets a
// 4xx, the system settings page becomes unusable for everyone, and there is no
// route back through the API: someone has to hand-edit JSONB in production to
// restore the ability to toggle a feature flag. Worse for a repo that exists
// to be EXTENDED: the moment a downstream app adds a key to this row, its
// admins discover the constraint as an outage. And a deploy that rolls back
// across the addition of a key — build N knows `branding`, build N-1 does not
// — turns a routine rollback into "settings cannot be saved". Under this file,
// that same rollback window is uneventful: N-1 carries `branding` forward
// untouched and N finds it intact.
//
// WHY PUT PRESERVES TOO, WHICH LOOKS LIKE A SEMANTIC VIOLATION AND IS NOT.
// PUT replaces the resource as REPRESENTED. `getSettings` projects exactly
// `{ ui, features, updatedAt, updatedBy, version }`; unknown keys have never
// been part of that representation, so no client can read them, and therefore
// no client can echo them back in a PUT. Asking PUT to replace what GET never
// showed would mean "every full save destroys storage the caller was not even
// allowed to see" — which is the bug, restated. `ui` and `features` are
// replaced wholesale exactly as before; only the invisible remainder survives.
//
// WHY NOT `.passthrough()` ON THE SCHEMA (the other half of the obvious fix).
// Passthrough would let unknown keys in from the REQUEST as well, turning an
// admin-authenticated endpoint into an arbitrary JSONB writer with no cap and
// no shape — the unvalidated growth #126 had to bound in `notifications` with
// key patterns and per-channel caps. Preserving from storage gets the safety
// without opening the door: the set of unknown keys can only ever shrink (a
// key becomes known when someone adds it to the schema) or come from a path
// that is not this endpoint.
//
// PRESERVED IS NOT THE SAME AS SUPPORTED. A preserved key round-trips through
// storage; it does NOT appear in `GET /api/system-settings`, is not reachable
// through `getSettingValue`, and is not validated. Adding a real setting still
// means adding it to `systemSettingsSchema`, `SystemSettingsValue` and the
// response projection. What this buys is that forgetting a step costs you a
// missing feature instead of destroyed data. And for anything with its own
// lifecycle, provenance or secrets, the right answer remains a row of its own,
// as #122's email settings did (`system_settings.key = 'email'`): a separate
// row cannot be clobbered by this one at all, keeps SMTP host and username out
// of this response, and gets an independent version counter for `If-Match`.
//
// The sibling precedent is `user-settings.service.ts`, which reaches the same
// place from the other direction: every namespace there is declared explicitly
// and merged explicitly, with "only set the key when the merge produced
// something" so an emptied namespace collapses to absent rather than `{}`.
// Same principle — a write path must never quietly redefine state it did not
// mean to touch.
// =============================================================================

/**
 * The top-level keys `systemSettingsSchema` actually understands.
 *
 * DERIVED FROM THE SCHEMA, never written out as literals. A hand-maintained
 * list is precisely the thing that goes stale: someone adds `branding` to the
 * schema, forgets the list, and the new key is treated as "unknown" — carried
 * forward but never validated, which is a quieter version of the same bug.
 * Deriving it means the two cannot drift.
 */
const KNOWN_TOP_LEVEL_KEYS: readonly string[] = Object.keys(
  systemSettingsSchema.shape,
);

/**
 * The keys of the nested `ui` object, derived for the same reason.
 *
 * `ui` needs its own list because it is the only CLOSED nested object in the
 * value: `features` is a `z.record`, so it is already open and nothing there
 * can be stripped. An unknown key inside `ui` (say a `ui.density` left behind
 * by a rolled-back deploy) is destroyed by exactly the same mechanism as an
 * unknown top-level key, so it gets exactly the same treatment.
 */
const KNOWN_UI_KEYS: readonly string[] = Object.keys(
  systemSettingsSchema.shape.ui.shape,
);

@Injectable()
export class SystemSettingsService {
  private readonly logger = new Logger(SystemSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Load the 'global' row, creating it with defaults if it is missing.
   *
   * Extracted so the read path and the PATCH path share one definition of
   * "the current row" — PATCH needs the RAW stored value (to see the keys the
   * projection hides), not the projection, and before #130 it had no way to
   * ask for it: it called `getSettings()` and could only ever see `ui` and
   * `features`. That is not incidental to the bug, it IS the bug.
   */
  private async loadOrCreateRow() {
    const existing = await this.prisma.systemSettings.findUnique({
      where: { key: SETTINGS_KEY },
      include: {
        updatedByUser: {
          select: { id: true, email: true },
        },
      },
    });

    if (existing) {
      return existing;
    }

    // Should have been seeded, but create if missing
    const created = await this.prisma.systemSettings.create({
      data: {
        key: SETTINGS_KEY,
        value: DEFAULT_SYSTEM_SETTINGS as any,
      },
      include: {
        updatedByUser: {
          select: { id: true, email: true },
        },
      },
    });
    this.logger.warn('Created default system settings - seed may not have run');

    return created;
  }

  /**
   * Collect the entries of `stored` whose keys are not in `knownKeys`.
   *
   * Defensive about the input type on purpose: `stored` is a JSONB column, so
   * at runtime it can be a string, a number, an array or null no matter what
   * the TypeScript type says. Anything that is not a plain object contributes
   * no keys rather than throwing — a malformed row must not make settings
   * unsavable, which is the failure mode this whole change exists to avoid.
   */
  private collectUnknownKeys(
    stored: unknown,
    knownKeys: readonly string[],
  ): Record<string, unknown> {
    if (
      stored === null ||
      typeof stored !== 'object' ||
      Array.isArray(stored)
    ) {
      return {};
    }

    const unknown: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      stored as Record<string, unknown>,
    )) {
      if (!knownKeys.includes(key)) {
        unknown[key] = value;
      }
    }

    return unknown;
  }

  /**
   * Produce the object to persist: the validated known settings, with every
   * unrecognised key of the currently stored value laid back underneath.
   *
   * Spread order is load-bearing. The unknown keys go FIRST so that `validated`
   * always wins: if a key is known, the caller's (validated) value is
   * authoritative and the stored one is replaced, which is what preserves the
   * existing behaviour of `ui` and `features` byte for byte. The unknown keys
   * can only ever fill slots `validated` does not occupy.
   *
   * Returns the preserved paths alongside the value so the caller can put them
   * in the log and the audit meta. That reporting is not decoration: #130's
   * complaint is as much "nothing in the audit trail" as it is the data loss,
   * and a key silently surviving is only marginally better than a key silently
   * disappearing — either way nobody learns that this row holds something the
   * code does not model.
   */
  private mergePreservingUnknown(
    storedValue: unknown,
    validated: SystemSettingsDto,
  ): { value: Record<string, unknown>; preservedPaths: string[] } {
    const unknownTopLevel = this.collectUnknownKeys(
      storedValue,
      KNOWN_TOP_LEVEL_KEYS,
    );

    const storedUi =
      storedValue !== null &&
      typeof storedValue === 'object' &&
      !Array.isArray(storedValue)
        ? (storedValue as Record<string, unknown>).ui
        : undefined;
    const unknownUi = this.collectUnknownKeys(storedUi, KNOWN_UI_KEYS);

    const value: Record<string, unknown> = {
      ...unknownTopLevel,
      ...validated,
      ui: { ...unknownUi, ...validated.ui },
    };

    const preservedPaths = [
      ...Object.keys(unknownTopLevel),
      ...Object.keys(unknownUi).map((key) => `ui.${key}`),
    ];

    return { value, preservedPaths };
  }

  /**
   * Report preserved keys once per write, on the log line and in the audit
   * meta. Omitted entirely when there is nothing to report so the audit rows
   * of a normal deployment (where `ui` and `features` are all there is) stay
   * exactly as they were.
   */
  private reportPreserved(operation: string, preservedPaths: string[]) {
    if (preservedPaths.length === 0) {
      return;
    }

    this.logger.warn(
      `System settings ${operation}: preserved ${preservedPaths.length} key(s) not modelled by systemSettingsSchema (${preservedPaths.join(', ')}). ` +
        'They survive the write but are not validated and are not returned by GET /api/system-settings — add them to the schema, or give them their own system_settings row (see #130).',
    );
  }

  /**
   * Get system settings
   * Creates default if not found (should exist from seed)
   *
   * DELIBERATELY STILL A NARROW PROJECTION. Preserved-but-unknown keys are not
   * surfaced here: the response is typed by `SystemSettingsResponseDto` and
   * consumed by the admin UI, and leaking unmodelled storage into a public
   * contract is a different (and worse) decision than not destroying it.
   * Preservation is a safety net, not a read path — see the header.
   */
  async getSettings() {
    const settings = await this.loadOrCreateRow();

    const value = settings.value as unknown as SystemSettingsValue;

    return {
      ui: value.ui,
      features: value.features,
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedByUser,
      version: settings.version,
    };
  }

  /**
   * Replace system settings (PUT)
   */
  async replaceSettings(dto: UpdateSystemSettingsDto, userId: string) {
    // Validate against schema. This still strips unknown keys out of the
    // REQUEST, and is meant to: the body is the untrusted half.
    const validated = systemSettingsSchema.parse(dto);

    // Read the stored value before overwriting it, purely to recover the keys
    // this code does not model. `select` is narrow because nothing else is
    // needed — the upsert below still handles the row not existing yet, so
    // this read deliberately does NOT create anything.
    const current = await this.prisma.systemSettings.findUnique({
      where: { key: SETTINGS_KEY },
      select: { value: true },
    });

    // Read-then-write, unguarded, exactly as PATCH has always been: two
    // simultaneous PUTs can still race, and the loser's `ui`/`features` lose
    // as they always did. The race window is not widened for the preserved
    // keys in any way that matters, because both racers read the same
    // untouched unknown keys and write them back identically.
    const { value, preservedPaths } = this.mergePreservingUnknown(
      current?.value,
      validated,
    );

    const settings = await this.prisma.systemSettings.upsert({
      where: { key: SETTINGS_KEY },
      update: {
        value: value as any,
        updatedByUserId: userId,
        version: { increment: 1 },
      },
      create: {
        key: SETTINGS_KEY,
        value: value as any,
        updatedByUserId: userId,
      },
      include: {
        updatedByUser: {
          select: { id: true, email: true },
        },
      },
    });

    // Create audit event
    await this.createAuditEvent(userId, 'system_settings:replace', settings.id, {
      newValue: value,
      ...(preservedPaths.length > 0 ? { preservedKeys: preservedPaths } : {}),
    });

    this.reportPreserved('replace', preservedPaths);
    this.logger.log(`System settings replaced by user: ${userId}`);

    const stored = settings.value as unknown as SystemSettingsValue;

    return {
      ui: stored.ui,
      features: stored.features,
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedByUser,
      version: settings.version,
    };
  }

  /**
   * Partial update system settings (PATCH)
   */
  async patchSettings(
    dto: PatchSystemSettingsDto,
    userId: string,
    expectedVersion?: number,
  ) {
    // Get the current ROW, not the projection: the merge below needs the raw
    // stored value to carry unknown keys forward (#130).
    const row = await this.loadOrCreateRow();
    const currentValue = row.value as unknown as SystemSettingsValue;

    // Optimistic concurrency check. Unchanged, and still reads its version
    // from the same row the merge is built from — so the version that was
    // checked and the value that is merged can never come from two different
    // reads.
    if (expectedVersion !== undefined && row.version !== expectedVersion) {
      throw new ConflictException(
        `Settings version mismatch. Expected ${expectedVersion}, found ${row.version}`,
      );
    }

    // Deep merge with existing settings. The known namespaces are merged
    // exactly as before — `ui` field by field, `features` by spread, so a
    // partial `features` patch still adds to rather than replaces the map.
    const merged: SystemSettingsValue = {
      ui: {
        allowUserThemeOverride:
          dto.ui?.allowUserThemeOverride ??
          currentValue.ui.allowUserThemeOverride,
      },
      features: {
        ...currentValue.features,
        ...(dto.features || {}),
      },
    };

    // Validate merged result (still strict about the shape of what we know).
    const validated = systemSettingsSchema.parse(merged);

    // ...then restore what `parse` and the hand-built `merged` above both drop.
    // On a PATCH this is not a nicety: the caller asked to change one flag, so
    // anything else disappearing is unambiguously a defect regardless of what
    // one thinks PUT ought to mean.
    const { value, preservedPaths } = this.mergePreservingUnknown(
      row.value,
      validated,
    );

    const settings = await this.prisma.systemSettings.update({
      where: { key: SETTINGS_KEY },
      data: {
        value: value as any,
        updatedByUserId: userId,
        version: { increment: 1 },
      },
      include: {
        updatedByUser: {
          select: { id: true, email: true },
        },
      },
    });

    // Create audit event
    await this.createAuditEvent(userId, 'system_settings:patch', settings.id, {
      changes: dto,
      resultingValue: value,
      ...(preservedPaths.length > 0 ? { preservedKeys: preservedPaths } : {}),
    });

    this.reportPreserved('patch', preservedPaths);
    this.logger.log(`System settings patched by user: ${userId}`);

    const stored = settings.value as unknown as SystemSettingsValue;

    return {
      ui: stored.ui,
      features: stored.features,
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedByUser,
      version: settings.version,
    };
  }

  /**
   * Get a specific setting value
   *
   * Walks the PROJECTION, so it can only reach `ui` and `features` — a
   * preserved-but-unknown key is not addressable here. That is intentional:
   * this helper is a typed accessor for modelled settings, and letting it
   * return unvalidated blob contents would make "preserved" look like
   * "supported". See the header.
   */
  async getSettingValue<T>(path: string): Promise<T | undefined> {
    const settings = await this.getSettings();
    const parts = path.split('.');

    let value: any = settings;
    for (const part of parts) {
      value = value?.[part];
      if (value === undefined) break;
    }

    return value as T;
  }

  /**
   * Check if a feature flag is enabled
   */
  async isFeatureEnabled(featureName: string): Promise<boolean> {
    const settings = await this.getSettings();
    return settings.features[featureName] ?? false;
  }

  /**
   * Create audit event
   */
  private async createAuditEvent(
    actorUserId: string,
    action: string,
    targetId: string,
    meta: Record<string, unknown>,
  ) {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId,
        action,
        targetType: 'system_settings',
        targetId,
        meta: meta as any,
      },
    });
  }
}
