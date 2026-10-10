// The email settings hook (#737, moved from the reference app with the page):
// load, PUT with the loaded version as If-Match, a 409 reloads and says so,
// a 403 is named, and a failed test send is a result, never a rejection.
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { useEmailSettings } from '../../src/email/headless/index.js';
import type { EmailSettings } from '../../src/email/headless/index.js';
import { createTestApiError, createTestPlatformHost } from '../../src/testing/index.js';
import type { TestPlatformHost } from '../../src/testing/index.js';
import { emailSettingsFixture } from './fixtures.js';

const SETTINGS: EmailSettings = emailSettingsFixture({ fromAddress: undefined, fromName: undefined, smtpUsername: undefined });

function wrap(host: TestPlatformHost) {
  return ({ children }: { children: ReactNode }) => <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}

describe('useEmailSettings', () => {
  it('loads, then saves with the loaded version as If-Match and adopts the response', async () => {
    const host = createTestPlatformHost({
      responses: { 'GET /email-settings': SETTINGS, 'PUT /email-settings': { ...SETTINGS, version: 4 } },
    });
    const { result } = renderHook(() => useEmailSettings(), { wrapper: wrap(host) });
    await waitFor(() => expect(result.current.settings?.version).toBe(3));

    let saved = false;
    await act(async () => {
      saved = await result.current.save({ provider: 'smtp', enabled: true, smtpPassword: '' });
    });

    expect(saved).toBe(true);
    expect(host.requests.at(-1)).toEqual({
      method: 'PUT',
      path: '/email-settings',
      body: { provider: 'smtp', enabled: true, smtpPassword: '' },
      ifMatch: '3',
    });
    expect(result.current.settings?.version).toBe(4);
  });

  it('names a 403 on load', async () => {
    const host = createTestPlatformHost({
      responses: {
        'GET /email-settings': () => {
          throw createTestApiError(403, 'Forbidden');
        },
      },
    });
    const { result } = renderHook(() => useEmailSettings(), { wrapper: wrap(host) });
    await waitFor(() => expect(result.current.loadError).toBe('You do not have permission to view email settings'));
  });

  it('reloads on a 409 and asks the admin to review', async () => {
    let gets = 0;
    const host = createTestPlatformHost({
      responses: {
        'GET /email-settings': () => ({ ...SETTINGS, version: 3 + gets++ }),
        'PUT /email-settings': () => {
          throw createTestApiError(409, 'stale');
        },
      },
    });
    const { result } = renderHook(() => useEmailSettings(), { wrapper: wrap(host) });
    await waitFor(() => expect(result.current.settings).not.toBeNull());

    let saved = true;
    await act(async () => {
      saved = await result.current.save({ provider: null, enabled: false });
    });

    expect(saved).toBe(false);
    expect(gets).toBe(2);
    expect(result.current.saveError).toMatch(/Someone else changed the email settings/);
  });

  it('records a failed call to the test endpoint as a failed result, not a rejection', async () => {
    const host = createTestPlatformHost({
      responses: {
        'GET /email-settings': SETTINGS,
        'POST /email-settings/test': () => {
          throw createTestApiError(500, 'Provider module crashed');
        },
      },
    });
    const { result } = renderHook(() => useEmailSettings(), { wrapper: wrap(host) });
    await waitFor(() => expect(result.current.settings).not.toBeNull());

    await act(() => result.current.sendTest());

    expect(result.current.testResult).toEqual({ success: false, error: 'Provider module crashed' });
    expect(result.current.isTesting).toBe(false);
  });

  it('keeps a 200 with success: false as the provider said it', async () => {
    const refused = { success: false, sentTo: 'a@example.test', providerKind: 'smtp', messageId: null, error: '535 Authentication failed', attemptedAt: '2026-10-08T00:00:00.000Z' };
    const host = createTestPlatformHost({ responses: { 'GET /email-settings': SETTINGS, 'POST /email-settings/test': refused } });
    const { result } = renderHook(() => useEmailSettings(), { wrapper: wrap(host) });
    await waitFor(() => expect(result.current.settings).not.toBeNull());

    await act(() => result.current.sendTest());

    expect(result.current.testResult).toEqual(refused);
  });
});
