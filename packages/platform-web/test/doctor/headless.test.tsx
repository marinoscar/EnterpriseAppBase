import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import {
  DOCTOR_STATUS_ORDER,
  PLATFORM_DOCTOR_CATEGORY_LABELS,
  categoryLabel,
  createDoctorClient,
  useDoctor,
} from '../../src/doctor/headless/index.js';
import type { DoctorReport } from '../../src/doctor/headless/index.js';
import { createTestApiError, createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiResponse, TestPlatformHost } from '../../src/testing/index.js';
import { MIXED } from './fixtures.js';

function hostWith(response: TestApiResponse): TestPlatformHost {
  return createTestPlatformHost({ permissions: ['system_settings:read'], responses: { 'GET /admin/doctor': response } });
}

function wrap(host: TestPlatformHost) {
  return ({ children }: { children: ReactNode }) => <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}

describe('createDoctorClient', () => {
  it('builds the query string from the options', async () => {
    const host = hostWith(MIXED);
    const client = createDoctorClient(host.api);

    await client.getReport();
    await client.getReport({ refresh: true });
    await client.getReport({ category: 'core', refresh: false });

    expect(host.requests.map((r) => r.path)).toEqual(['/admin/doctor', '/admin/doctor?refresh=true', '/admin/doctor?category=core']);
  });

  it('takes the app path when the route was moved', async () => {
    const host = createTestPlatformHost({ responses: { 'GET /ops/doctor': MIXED } });

    await expect(createDoctorClient(host.api, '/ops/doctor').getReport()).resolves.toBe(MIXED);
  });
});

describe('useDoctor', () => {
  it('loads on mount without refresh, and resolves to the report', async () => {
    const host = hostWith(MIXED);
    const { result } = renderHook(() => useDoctor(), { wrapper: wrap(host) });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.report).toBeNull();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.report?.checks).toHaveLength(5);
    expect(result.current.error).toBeNull();
    expect(host.requests.map((r) => r.path)).toEqual(['/admin/doctor']);
  });

  it('treats a failing verdict as data, not as an error', async () => {
    const { result } = renderHook(() => useDoctor(), { wrapper: wrap(hostWith({ ...MIXED, verdict: 'fail' })) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.report?.verdict).toBe('fail');
    expect(result.current.error).toBeNull();
  });

  it('names a 403 explicitly', async () => {
    const host = hostWith(() => {
      throw createTestApiError(403, 'Insufficient permissions');
    });
    const { result } = renderHook(() => useDoctor(), { wrapper: wrap(host) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('You do not have permission to run the Doctor');
    expect(result.current.report).toBeNull();
  });

  it('falls back to a readable message on a network failure', async () => {
    const host = hostWith(() => Promise.reject(new TypeError('Failed to fetch')));
    const { result } = renderHook(() => useDoctor(), { wrapper: wrap(host) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('Failed to run the Doctor checks');
  });

  it('reruns with refresh=true, adopts the new report and clears a previous error', async () => {
    let fail = true;
    const host = hostWith((): DoctorReport => {
      if (fail) throw createTestApiError(500, 'Boom');
      return { ...MIXED, verdict: 'warn' };
    });
    const { result } = renderHook(() => useDoctor(), { wrapper: wrap(host) });
    await waitFor(() => expect(result.current.error).toBe('Boom'));

    fail = false;
    await act(async () => {
      await result.current.rerun();
    });

    expect(host.requests.at(-1)?.path).toBe('/admin/doctor?refresh=true');
    expect(result.current.report?.verdict).toBe('warn');
    expect(result.current.error).toBeNull();
  });

  it('uses an explicit client without any host', async () => {
    const client = createDoctorClient(hostWith(MIXED).api);
    const { result } = renderHook(() => useDoctor(client));

    await waitFor(() => expect(result.current.report).not.toBeNull());
  });

  it('throws a clear error with neither a host nor a client', () => {
    expect(() => renderHook(() => useDoctor())).toThrow(/no PlatformHostProvider above this component and no client/);
  });
});

describe('categories', () => {
  it('ships the eleven categories in display order', () => {
    expect(PLATFORM_DOCTOR_CATEGORY_LABELS.map((c) => c.key)).toEqual([
      'core',
      'auth',
      'maintenance',
      'storage',
      'email',
      'push',
      'ai',
      'jobs',
      'nodes',
      'backup',
      'telemetry',
    ]);
    expect(DOCTOR_STATUS_ORDER).toEqual(['pass', 'skip', 'warn', 'fail']);
  });

  it('labels known categories and title-cases unknown ones, with custom labels too', () => {
    expect(categoryLabel('push')).toBe('Web Push');
    expect(categoryLabel('backup')).toBe('Database backup');
    expect(categoryLabel('fork_widgets')).toBe('Fork Widgets');
    expect(categoryLabel('billing')).toBe('Billing');
    expect(categoryLabel('billing', [{ key: 'billing', label: 'Invoices' }])).toBe('Invoices');
  });
});
