// The reference app's Android companion wiring (#746): the identity every
// surface shares, the client an app component would call, the release hook,
// and the admin card's permission pinned to the API controller.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ANDROID_IDENTITY_SOURCE } from '@app/shared';
import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import { createTestPlatformHost } from '@marinoscar/platform-web/testing';
import {
  androidIdentity,
  createAndroidAppClient,
  useAndroidRelease,
} from '@marinoscar/platform-web/android-app/headless';
import { androidAppSettingsPage } from '@marinoscar/platform-web/android-app/ui';

import { ADMIN_SECTIONS } from '../../config/adminSections';
import { ANDROID_IDENTITY, ANDROID_TWA_KEY_PREFIX } from '../../config/androidApp';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..', '..');

const RELEASE = {
  id: '00000000-0000-4000-8000-000000000001',
  packageName: ANDROID_IDENTITY.applicationId,
  versionName: '1.0.0',
  versionCode: 1,
  fileSha256: 'a'.repeat(64),
  sizeBytes: '1024',
  notes: null,
  createdAt: '2026-10-08T00:00:00.000Z',
};

describe('the reference app Android companion (#746)', () => {
  it('derives the identity from identity.json, with the storage prefix as the TWA key prefix', () => {
    expect(ANDROID_IDENTITY).toEqual(androidIdentity(ANDROID_IDENTITY_SOURCE));
    expect(ANDROID_IDENTITY.applicationId).toMatch(/^com\.[a-z][a-z0-9]*\.android$/);
    expect(ANDROID_TWA_KEY_PREFIX).toBe(ANDROID_IDENTITY.storagePrefix);
  });

  it('calls the API through createAndroidAppClient', async () => {
    const host = createTestPlatformHost({
      responses: { 'POST /android-app/releases/00000000-0000-4000-8000-000000000001/download-link': { url: '/api/android-app/download/t', expiresAt: '2026-10-08T00:10:00.000Z' } },
    });
    const client = createAndroidAppClient(host.api);
    expect((await client.downloadLink(RELEASE.id)).url).toBe('/api/android-app/download/t');
  });

  it('reads the current release with useAndroidRelease, and nothing when disabled', async () => {
    const host = createTestPlatformHost({ responses: { 'GET /android-app/releases/latest': RELEASE } });
    const wrapper = ({ children }: { children: ReactNode }) => <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
    const { result } = renderHook(() => useAndroidRelease(true), { wrapper });
    await waitFor(() => expect(result.current.release?.versionCode).toBe(1));
    const before = host.requests.length;
    renderHook(() => useAndroidRelease(false), { wrapper });
    expect(host.requests.length).toBe(before);
  });

  it('declares the Android app card with the exact permission the API controller enforces', () => {
    const card = ADMIN_SECTIONS.flatMap((section) => section.cards).find((c) => c.path === androidAppSettingsPage.card.path);
    expect(card?.permission).toBe('system_settings:read');
    const controller = readFileSync(resolve(REPO, 'packages/platform-api/src/android-app/android-app.controller.ts'), 'utf8');
    expect(controller).toMatch(/@Get\(\)\s*\n\s*@Auth\(\{ permissions: \[SETTINGS_PERMISSIONS\.SYSTEM_SETTINGS_READ\.id\] \}\)/);
    const settingsPermissions = readFileSync(resolve(REPO, 'packages/platform-api/src/settings/settings.permissions.ts'), 'utf8');
    expect(settingsPermissions).toContain("id: 'system_settings:read'");
  });
});
