// The consumer's web app: the packaged Doctor page bound to a host the
// consumer defines itself (the reference app's is
// apps/web/src/platform/platformHost.tsx). The fake host answers the Doctor's
// one request with a canned report that includes the consumer's own check.

import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import type { PlatformApiClient, PlatformWebHost } from '@marinoscar/platform-web/core';
import { PLATFORM_DOCTOR_CATEGORY_LABELS } from '@marinoscar/platform-web/doctor/headless';
import type { DoctorReport } from '@marinoscar/platform-web/doctor/headless';
import { DoctorPage } from '@marinoscar/platform-web/doctor/ui';

export const SMOKE_REPORT: DoctorReport = {
  verdict: 'warn',
  generatedAt: '2026-01-01T00:00:00.000Z',
  durationMs: 12,
  checks: [
    {
      id: 'smoke.consumer',
      category: 'smoke',
      label: 'Consumer smoke check',
      settingsPath: '/settings/smoke',
      status: 'pass',
      detail: 'Registered by the consumer app',
      remedy: null,
      error: null,
      data: { external: true },
      durationMs: 3,
    },
    {
      id: 'smoke.dependent',
      category: 'smoke',
      label: 'Consumer dependent check',
      settingsPath: null,
      status: 'warn',
      detail: 'A deliberate warning',
      remedy: 'Nothing to fix: the smoke expects this warning.',
      error: null,
      data: null,
      durationMs: 1,
    },
  ],
};

export const SMOKE_CATEGORIES = [...PLATFORM_DOCTOR_CATEGORY_LABELS, { key: 'smoke', label: 'Consumer smoke' }];

/** The consumer's transport: answers GET /admin/doctor[?…] with `report`, rejects everything else. */
export function createSmokeApi(report: DoctorReport = SMOKE_REPORT): PlatformApiClient & { calls: string[] } {
  const calls: string[] = [];
  const refuse = (path: string) => Promise.reject({ status: 404, message: `no route ${path}` });
  return {
    calls,
    get<T>(path: string): Promise<T> {
      calls.push(path);
      return path.split('?')[0] === '/admin/doctor' ? Promise.resolve(report as T) : refuse(path);
    },
    post: (path: string) => refuse(path),
    put: (path: string) => refuse(path),
    patch: (path: string) => refuse(path),
    delete: (path: string) => refuse(path),
  };
}

export function createSmokeHost(api: PlatformApiClient = createSmokeApi()): PlatformWebHost {
  return {
    api,
    viewer: {
      userId: 'smoke-user',
      hasPermission: (permission) => permission === 'system_settings:read',
      isFeatureEnabled: () => true,
    },
  };
}

const theme = createTheme();

export function App({ host = createSmokeHost() }: { host?: PlatformWebHost }): ReactElement {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <PlatformHostProvider host={host}>
        <MemoryRouter>
          <DoctorPage categories={SMOKE_CATEGORIES} />
        </MemoryRouter>
      </PlatformHostProvider>
    </ThemeProvider>
  );
}
