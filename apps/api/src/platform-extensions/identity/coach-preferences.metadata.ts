import { z } from 'zod';

// =============================================================================
// EXAMPLE: an app metadata namespace on users (PP-14.27)
// =============================================================================
//
// `users.metadata` is a JSONB document the app fills with namespaced fields of
// its own, so a per-user setting needs no side table and no migration. One
// namespace is one top-level key; its schema is declared once and validates
// every write and every read.
//
//   1. THIS FILE declares the shape (a closed zod object: no `z.any()`, no
//      secret-named field).
//   2. `app-registrations/identity.ts` registers it AT IMPORT TIME with
//      `registerUserMetadataSchema`, which returns the typed handle.
//   3. `CoachPreferencesService` reads and writes it through the platform's
//      `IdentityMetadataService`. Nothing is exposed over HTTP until the app
//      writes a route (`CoachPreferencesController` is the example).
//
// What does NOT belong here: anything secret. A secret goes in the encrypted
// credential store (`user_credentials`); a `hasKey` flag may sit here.
// Anything large or queried by column belongs in a table of its own: the
// whole document may not exceed 16 KiB.
//
// The reference app registers the namespace (it adds no route and no column);
// a fork that does not want the example deletes the registration and these files.
// Recipe: docs/EXTENDING.md, "Add app metadata to users and organizations".
// =============================================================================

/** The JSON key of the namespace. Permanent once rows hold it. */
export const COACH_PREFERENCES_NAMESPACE = 'preferences.coach';

/** A coach's own settings. */
export const coachPreferencesSchema = z.object({
  /** Local hour of the daily reminder, 0 to 23. */
  reminderHour: z.number().int().min(0).max(23),
  /** Whether the weekly digest email is on. */
  weeklyDigest: z.boolean(),
  /** Athlete labels the coach uses to group workouts. */
  labels: z.array(z.string().min(1).max(40)).max(20).default([]),
});

/** The stored value. */
export type CoachPreferences = z.infer<typeof coachPreferencesSchema>;

/** What a coach sees before they have saved anything. */
export const DEFAULT_COACH_PREFERENCES: CoachPreferences = { reminderHour: 8, weeklyDigest: true, labels: [] };
