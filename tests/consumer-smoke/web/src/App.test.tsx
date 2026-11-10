// The web consumer smoke (issue #697), run by `npm test` inside the temporary
// consumer project that ../../run.mjs creates outside the repository.

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createDoctorClient } from '@marinoscar/platform-web/doctor/headless';
import { usePlatformHost } from '@marinoscar/platform-web/core';

import { App, SMOKE_REPORT, createSmokeApi, createSmokeHost } from './App';

describe('the packaged Doctor page in a consumer app', () => {
  it('renders the consumer check row from the host transport', async () => {
    const api = createSmokeApi();
    render(<App host={createSmokeHost(api)} />);

    const row = await screen.findByTestId('doctor-check-smoke.consumer');
    expect(within(row).getByText('Consumer smoke check')).toBeTruthy();
    expect(screen.getByTestId('doctor-check-smoke.dependent')).toBeTruthy();
    expect(screen.getByText('Nothing to fix: the smoke expects this warning.')).toBeTruthy();
    expect(screen.getByText('Consumer smoke')).toBeTruthy();
    expect(api.calls[0]?.split('?')[0]).toBe('/admin/doctor');
  });
});

describe('the headless client', () => {
  it('fetches the report through the consumer transport', async () => {
    const api = createSmokeApi();
    const report = await createDoctorClient(api).getReport({ category: 'smoke', refresh: true });
    expect(report).toEqual(SMOKE_REPORT);
    expect(api.calls).toEqual(['/admin/doctor?category=smoke&refresh=true']);
  });
});

describe('the host port', () => {
  it('refuses to render a packaged page without PlatformHostProvider', () => {
    function NeedsHost() {
      usePlatformHost();
      return null;
    }
    const error = console.error;
    console.error = () => {};
    try {
      expect(() => render(<NeedsHost />)).toThrow(/PlatformHostProvider/);
    } finally {
      console.error = error;
    }
  });
});
