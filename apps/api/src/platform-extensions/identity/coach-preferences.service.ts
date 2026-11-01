import { Injectable } from '@nestjs/common';
import { IdentityMetadataService } from '@marinoscar/platform-api/identity';

import { coachPreferences } from '../../app-registrations/identity';
import { DEFAULT_COACH_PREFERENCES, type CoachPreferences } from './coach-preferences.metadata';

/**
 * EXAMPLE (PP-14.27): an app service over a metadata namespace. It never
 * touches `users.metadata` itself: the platform's `IdentityMetadataService`
 * validates against the registered schema, enforces the 16 KiB document limit,
 * refuses secret-named keys and locks the row for the read-modify-write.
 */
@Injectable()
export class CoachPreferencesService {
  constructor(private readonly metadata: IdentityMetadataService) {}

  /** The user's preferences, or the defaults before they have saved any. */
  async get(userId: string): Promise<CoachPreferences> {
    return (await this.metadata.getUserMetadata(userId, coachPreferences)) ?? DEFAULT_COACH_PREFERENCES;
  }

  /** Changes some of the preferences, atomically; returns what is stored. */
  update(userId: string, patch: Partial<CoachPreferences>): Promise<CoachPreferences> {
    return this.metadata.updateUserMetadata(userId, coachPreferences, (current) => ({
      ...(current ?? DEFAULT_COACH_PREFERENCES),
      ...patch,
    }));
  }
}
