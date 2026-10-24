// =============================================================================
// Example: importing an app's existing share tokens (issue #732)
// =============================================================================
//
// Extension point: `importLegacyToken` (rung 5; experimental). FOR A DATA
// MIGRATION ONLY, never a request path.
//
// MemoriaHub's `MediaShare` rows carry a clear 43-character token (served at
// `/s/<token>`), an `expiresAt`, a `revokedAt` and a `createdById`. Each row
// becomes a link grant whose token is `lnk_<old token>`: hashed (SHA-256) and
// encrypted (`SECRETS_ENCRYPTION_KEY`) exactly as a minted one, so the clear
// column can be dropped afterwards. Links already handed out keep working
// through a web redirect from `/s/:token` to `/s#lnk_:token`.
//
// Runs on the system bypass with the `migration-tooling` reason, in ONE
// transaction: every share imports, or none does. Proven by
// ./group-owned-resource.example.db.spec.ts.
// =============================================================================

import { importLegacyToken } from '@marinoscar/platform-api/sharing';

import type { PrismaSystemService } from '../../../src/prisma/prisma-system.service';
import { ALBUM_TYPE } from './group-owned-resource.example';

/** One row of the app's old share table (MemoriaHub's `MediaShare`, shaped for an album). */
export interface LegacyAlbumShare {
  orgId: string;
  albumId: string;
  token: string;
  createdById: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/** Imports every old share as a `viewer` link grant; returns the new `lnk_` tokens by old token. */
export async function importAlbumShares(system: PrismaSystemService, shares: readonly LegacyAlbumShare[]): Promise<Map<string, string>> {
  return system.runAsSystem('migration-tooling', async (tx) => {
    const tokens = new Map<string, string>();
    for (const share of shares) {
      const imported = await importLegacyToken(tx, {
        orgId: share.orgId,
        resourceType: ALBUM_TYPE,
        resourceId: share.albumId,
        role: 'viewer',
        token: share.token,
        grantedById: share.createdById,
        createdAt: share.createdAt,
        expiresAt: share.expiresAt,
        revokedAt: share.revokedAt,
      });
      tokens.set(share.token, imported.token);
    }
    return tokens;
  });
}
