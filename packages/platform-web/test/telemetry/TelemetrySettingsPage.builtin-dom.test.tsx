/**
 * The built-in store's settings page did not move (PP-14.11).
 *
 * The telemetry settings page shows the GreptimeDB connection form when the
 * deployment's store is the built-in `greptime`, and a generated form for any
 * other registered store. The snapshot beside this file (`__snapshots__/`) was
 * RECORDED FROM THE PAGE AS IT WAS BEFORE THAT CHANGE (same fixtures, rendered
 * by the old `TelemetrySettingsPage`), so passing means the page an
 * administrator sees is, element for element and class for class, the one they
 * had: the policy form, the status card, the services and the Connection
 * section, in every state below. Re-record only for a deliberate change.
 */
import { describe, expect, it } from 'vitest';

import TelemetrySettingsPage from '../../src/telemetry/ui/pages/TelemetrySettingsPage.js';
import { render, screen, mockAdminUser } from './harness.js';
import type { MockUser } from './harness.js';
import {
  mockTelemetryAdminConfig,
  mockTelemetryConnectionAutomaticEnvironment,
  mockTelemetryConnectionCustomStored,
  mockTelemetryConnectionNone,
  mockTelemetryConnectionStored,
  mockTelemetryStackMissing,
  mockTelemetryStackRunning,
  mockTelemetryStatus,
  mockTelemetryStatusUnconfigured,
} from './fixtures/telemetry.js';

const readOnlyAdmin: MockUser = {
  ...mockAdminUser,
  permissions: mockAdminUser.permissions.filter((permission) => permission !== 'telemetry:write'),
};

async function mount(
  responses: Record<string, unknown>,
  options: { user?: MockUser } = {},
): Promise<string> {
  const { container, unmount } = render(<TelemetrySettingsPage />, {
    wrapperOptions: {
      telemetryEnabled: true,
      aiEnabled: true,
      route: '/admin/settings/telemetry',
      user: options.user ?? mockAdminUser,
      responses: responses as never,
    },
  });
  await screen.findByRole('switch', { name: 'Collect telemetry' });
  // The connection section and the services card load on their own requests.
  await screen.findByRole('heading', { level: 2, name: 'Connection' });
  await screen.findByRole('heading', { level: 2, name: 'Telemetry services' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const html = container.innerHTML;
  unmount();
  return html;
}

const base = {
  'GET /admin/telemetry/config': mockTelemetryAdminConfig,
  'GET /admin/telemetry/status': mockTelemetryStatus,
  'GET /admin/telemetry/connection': mockTelemetryConnectionStored,
  'GET /admin/telemetry/stack': mockTelemetryStackRunning,
};

describe("the built-in store's settings page is unchanged", () => {
  it('a saved automatic connection, reachable, services running', async () => {
    expect(await mount(base)).toMatchSnapshot();
  });

  it('a custom stored connection', async () => {
    expect(
      await mount({ ...base, 'GET /admin/telemetry/connection': mockTelemetryConnectionCustomStored }),
    ).toMatchSnapshot();
  });

  it('the deployment default (nothing saved)', async () => {
    expect(
      await mount({ ...base, 'GET /admin/telemetry/connection': mockTelemetryConnectionAutomaticEnvironment }),
    ).toMatchSnapshot();
  });

  it('no store configured, services missing', async () => {
    expect(
      await mount({
        ...base,
        'GET /admin/telemetry/status': mockTelemetryStatusUnconfigured,
        'GET /admin/telemetry/connection': mockTelemetryConnectionNone,
        'GET /admin/telemetry/stack': mockTelemetryStackMissing,
      }),
    ).toMatchSnapshot();
  });

  it('a read-only viewer', async () => {
    expect(await mount(base, { user: readOnlyAdmin })).toMatchSnapshot();
  });
});
