/**
 * PP-14.23: an app draws the facts of its own Doctor check inside the check's
 * row with `registerDoctorCheckRenderer`, with no package edit.
 *
 * `apps/web/src/platform-extensions/doctor/ExampleCapabilityFacts.example.tsx`
 * is the example for the API's example check `example.capability`
 * (`apps/api/src/examples/doctor/example-capability.doctor-check.ts`), which
 * reports `data: { configured, enabled }`. This renders the REAL packaged
 * Doctor page over an MSW report, registers the renderer, and asserts the facts
 * sit in that check's row and nowhere else, that `slots.CheckRowActions` adds an
 * action to the row, and that without the registration the row is as it always
 * was.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { DoctorPage } from '@marinoscar/platform-web/doctor/ui';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import {
  EXAMPLE_CAPABILITY_CHECK_ID,
  registerExampleCapabilityRenderer,
} from '../../../platform-extensions/doctor/ExampleCapabilityFacts.example';

const API_BASE = '*/api';

const row = (overrides: Record<string, unknown>) => ({
  settingsPath: null,
  status: 'pass',
  detail: 'ok',
  remedy: null,
  error: null,
  data: null,
  durationMs: 4,
  ...overrides,
});

const REPORT = {
  verdict: 'fail',
  generatedAt: new Date().toISOString(),
  durationMs: 120,
  checks: [
    row({
      id: EXAMPLE_CAPABILITY_CHECK_ID,
      category: 'example',
      label: 'Example capability',
      status: 'fail',
      detail: 'The capability is on but has no configuration',
      remedy: 'Open the capability settings page and fill in the missing fields.',
      data: { configured: false, enabled: true },
    }),
    row({ id: 'other.check', category: 'example', label: 'Another check', status: 'warn', remedy: 'Look at it.', data: { configured: true, enabled: true } }),
  ],
};

const renderPage = (withActions = false) =>
  render(
    <DoctorPage
      slots={withActions ? { CheckRowActions: ({ check }) => <button type="button">Runbook for {check.id}</button> } : undefined}
    />,
    { wrapperOptions: { user: { ...mockAdminUser, permissions: ['system_settings:read'] }, route: '/admin/settings/doctor' } },
  );

describe('the Doctor page with an app check renderer (PP-14.23)', () => {
  let unregister: (() => void) | undefined;

  beforeEach(() => {
    server.resetHandlers();
    server.use(http.get(`${API_BASE}/admin/doctor`, () => HttpResponse.json({ data: REPORT })));
  });
  afterEach(() => unregister?.());

  it('draws the facts of the example check in its row and in no other', async () => {
    unregister = registerExampleCapabilityRenderer();
    renderPage();

    const mine = await screen.findByTestId(`doctor-check-${EXAMPLE_CAPABILITY_CHECK_ID}`);
    const facts = within(mine).getByLabelText('Capability facts');
    expect(within(facts).getByText('Not configured')).toBeInTheDocument();
    expect(within(facts).getByText('Switched on')).toBeInTheDocument();
    expect(within(screen.getByTestId('doctor-check-other.check')).queryByLabelText('Capability facts')).not.toBeInTheDocument();
    // The page's own text for the row is still there.
    expect(within(mine).getByTestId(`doctor-check-remedy-${EXAMPLE_CAPABILITY_CHECK_ID}`)).toHaveTextContent('fill in the missing fields');
  });

  it('draws the row as it always was without the registration', async () => {
    renderPage();

    const mine = await screen.findByTestId(`doctor-check-${EXAMPLE_CAPABILITY_CHECK_ID}`);
    expect(within(mine).queryByLabelText('Capability facts')).not.toBeInTheDocument();
  });

  it('adds an action to every row through CheckRowActions, beside a registered renderer', async () => {
    unregister = registerExampleCapabilityRenderer();
    renderPage(true);

    const mine = await screen.findByTestId(`doctor-check-${EXAMPLE_CAPABILITY_CHECK_ID}`);
    expect(within(mine).getByRole('button', { name: `Runbook for ${EXAMPLE_CAPABILITY_CHECK_ID}` })).toBeInTheDocument();
    expect(within(mine).getByLabelText('Capability facts')).toBeInTheDocument();
    expect(within(screen.getByTestId('doctor-check-other.check')).getByRole('button', { name: 'Runbook for other.check' })).toBeInTheDocument();
  });
});
