import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import type { PlatformApiClient } from '../../src/core/index.js';
import {
  SUPPORT_BUNDLE_PATH,
  filenameFromContentDisposition,
  useSupportBundleDownload,
} from '../../src/doctor/headless/index.js';
import { DoctorPage, SUPPORT_BUNDLE_HELPER_TEXT, SupportBundleButton } from '../../src/doctor/ui/index.js';
import { createTestApiError, createTestBlobResponse, createTestPlatformHost } from '../../src/testing/index.js';
import type { TestPlatformHost } from '../../src/testing/index.js';
import { MIXED } from './fixtures.js';

afterEach(() => cleanup());

const FILENAME = 'support-bundle-acme-20261006T090807Z.json';
const BUNDLE = createTestBlobResponse('{"bundleVersion":1}', {
  'Content-Type': 'application/json; charset=utf-8',
  'Content-Disposition': `attachment; filename="${FILENAME}"`,
});

function hostWith(download: unknown): TestPlatformHost {
  return createTestPlatformHost({
    permissions: ['system_settings:read'],
    responses: { 'GET /admin/doctor': MIXED, [`GET ${SUPPORT_BUNDLE_PATH}`]: download },
  });
}

function wrapper(host: TestPlatformHost) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <PlatformHostProvider host={host}>{children}</PlatformHostProvider>
    </MemoryRouter>
  );
}

describe('filenameFromContentDisposition', () => {
  it.each([
    [`attachment; filename="${FILENAME}"`, FILENAME],
    [`attachment; filename=${FILENAME}`, FILENAME],
    [`attachment; filename*=UTF-8''support%20bundle.json`, 'support bundle.json'],
    ['attachment; filename="../../etc/passwd"', '.._.._etc_passwd'],
    ['attachment', null],
    [null, null],
  ])('%j -> %j', (header, expected) => {
    expect(filenameFromContentDisposition(header)).toBe(expected);
  });
});

describe('useSupportBundleDownload', () => {
  it('GETs the bundle through the host transport and saves it under the server filename', async () => {
    const host = hostWith(BUNDLE);
    const save = vi.fn();
    const { result } = renderHook(() => useSupportBundleDownload({ save }), { wrapper: wrapper(host) });

    await act(() => result.current.download());

    expect(host.requests).toEqual([{ method: 'GET', path: '/admin/doctor/support-bundle' }]);
    expect(save).toHaveBeenCalledWith(BUNDLE.blob, FILENAME);
    expect(result.current).toMatchObject({ isDownloading: false, error: null, filename: FILENAME });
  });

  it('uses a custom path', async () => {
    const host = createTestPlatformHost({ responses: { 'GET /ops/doctor/support-bundle': BUNDLE } });
    const save = vi.fn();
    const { result } = renderHook(() => useSupportBundleDownload({ save, path: '/ops/doctor/support-bundle' }), {
      wrapper: wrapper(host),
    });

    await act(() => result.current.download());

    expect(save).toHaveBeenCalledWith(BUNDLE.blob, FILENAME);
  });

  it('names a 403 and keeps other API messages, resolving rather than throwing', async () => {
    const forbidden = hostWith(() => {
      throw createTestApiError(403, 'Forbidden');
    });
    const failing = hostWith(() => {
      throw createTestApiError(500, 'Bundle exploded');
    });
    const first = renderHook(() => useSupportBundleDownload({ save: vi.fn() }), { wrapper: wrapper(forbidden) });
    const second = renderHook(() => useSupportBundleDownload({ save: vi.fn() }), { wrapper: wrapper(failing) });

    await act(() => first.result.current.download());
    await act(() => second.result.current.download());

    expect(first.result.current.error).toBe('You do not have permission to download the support bundle');
    expect(second.result.current.error).toBe('Bundle exploded');
  });

  it('says so when the transport has no getBlob', async () => {
    const api: PlatformApiClient = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
    const { result } = renderHook(() => useSupportBundleDownload({ api, save: vi.fn() }));

    await act(() => result.current.download());

    expect(result.current.error).toMatch(/cannot download files/);
  });

  it('throws without a host or an api', () => {
    expect(() => renderHook(() => useSupportBundleDownload())).toThrow(/no PlatformHostProvider/);
  });
});

describe('SupportBundleButton', () => {
  it('shows the helper text and saves the file on click', async () => {
    const host = hostWith(BUNDLE);
    const save = vi.fn();
    render(<SupportBundleButton options={{ save }} />, { wrapper: wrapper(host) });

    expect(screen.getByText(SUPPORT_BUNDLE_HELPER_TEXT)).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Download support bundle' });
    expect(button.getAttribute('aria-describedby')).toBeTruthy();

    fireEvent.click(button);

    await waitFor(() => expect(save).toHaveBeenCalledWith(BUNDLE.blob, FILENAME));
  });

  it('shows the reason a download failed', async () => {
    const host = hostWith(() => {
      throw createTestApiError(500, 'Bundle exploded');
    });
    render(<SupportBundleButton options={{ save: vi.fn() }} />, { wrapper: wrapper(host) });

    fireEvent.click(screen.getByRole('button', { name: 'Download support bundle' }));

    expect((await screen.findByTestId('doctor-support-bundle-error')).textContent).toBe('Bundle exploded');
  });
});

describe('DoctorPage with the support bundle', () => {
  it('shows the button next to "Run again", and clicking it downloads the bundle', async () => {
    const host = hostWith(BUNDLE);
    const createObjectURL = vi.fn(() => 'blob:bundle');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    render(<DoctorPage />, { wrapper: wrapper(host) });
    await screen.findByTestId('doctor-verdict');

    fireEvent.click(screen.getByRole('button', { name: 'Download support bundle' }));

    await waitFor(() => expect(clicked).toEqual([FILENAME]));
    expect(host.requests.map((r) => r.path)).toContain('/admin/doctor/support-bundle');
    expect(createObjectURL).toHaveBeenCalledWith(BUNDLE.blob);
    click.mockRestore();
    vi.unstubAllGlobals();
  });
});
