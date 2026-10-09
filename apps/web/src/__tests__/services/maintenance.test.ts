/**
 * The app half of the maintenance wire contract (issue #258, epic #254; the
 * recogniser and its suite moved to `@marinoscar/platform-web/host` in #891).
 *
 * `MaintenanceGate` lets `MAINTENANCE_ADMIN_PATH` through, mirroring
 * `@AllowDuringMaintenance()` on the API's controller. The path is the package's
 * constant, the card is this app's: only the app can prove they agree.
 */

import { describe, it, expect } from 'vitest';
import { MAINTENANCE_ADMIN_PATH } from '../../services/maintenance';
import { ADMIN_SECTIONS } from '../../config/adminSections';

describe('maintenance wire contract — the app half', () => {
  it('exempts exactly the route the Maintenance card declares', () => {
    // If the card's route ever moves and the constant does not, the exemption
    // silently starts covering nothing — and an admin blocked by an
    // `allowAdmins: false` window loses the only page that would undo it.
    const card = ADMIN_SECTIONS.flatMap((section) => section.cards).find(
      (c) => c.title === 'Maintenance',
    );

    expect(card, 'ADMIN_SECTIONS must declare a Maintenance card').toBeDefined();
    expect(card!.path).toBe(MAINTENANCE_ADMIN_PATH);
  });
});
