// Test harness of the AI slice's package tests (issue #890): the
// `render(ui, { wrapperOptions })` shape the reference app's tests use, over a
// test platform host (canned responses, a viewer with the given permissions)
// inside a memory router. The app keeps its own wire tests against MSW; these
// tests cover the slice's internals without an app.

import { render as rtlRender } from '@testing-library/react';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { AiConfigContext } from '../../src/ai/headless/index.js';
import type { UseAiConfigReturn } from '../../src/ai/headless/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiResponse, TestPlatformHost } from '../../src/testing/index.js';
import { mockAiPublicConfigDisabled, mockAiPublicConfigEnabled, mockSignedUrl } from './fixtures.js';

/** The permissions a seeded administrator holds for the AI pages. */
export const ADMIN_PERMISSIONS = ['ai_config:read', 'ai_config:write', 'ai:use'] as const;

/** A user for `wrapperOptions.user` (only the permissions matter here). */
export const mockAdminUser = { permissions: [...ADMIN_PERMISSIONS] };

/** A user who may only use AI. */
export const mockUser = { permissions: ['ai:use'] };

export interface HarnessOptions extends Omit<RenderOptions, 'wrapper'> {
  wrapperOptions?: {
    user?: { permissions: readonly string[] };
    route?: string;
    /** A settled `AiConfigContext` answer: `true` AI on, `false` AI off. Omitted, no provider is mounted. */
    aiEnabled?: boolean;
  };
  /** Canned API responses of the test host. */
  responses?: Readonly<Record<string, TestApiResponse>>;
}

export type HarnessResult = RenderResult & { host: TestPlatformHost };

/** `render` inside a memory router and a test platform host. */
export function render(ui: ReactElement, options: HarnessOptions = {}): HarnessResult {
  const { wrapperOptions = {}, responses, ...rest } = options;
  const host = createTestPlatformHost({
    permissions: wrapperOptions.user?.permissions ?? mockUser.permissions,
    ...(responses === undefined ? {} : { responses }),
  });
  const aiValue: UseAiConfigReturn | null =
    wrapperOptions.aiEnabled === undefined
      ? null
      : {
          config: wrapperOptions.aiEnabled ? mockAiPublicConfigEnabled : mockAiPublicConfigDisabled,
          isLoading: false,
          error: null,
          refresh: vi.fn().mockResolvedValue(undefined),
        };
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    const inner = <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
    return (
      <MemoryRouter initialEntries={[wrapperOptions.route ?? '/']}>
        {aiValue ? <AiConfigContext.Provider value={aiValue}>{inner}</AiConfigContext.Provider> : inner}
      </MemoryRouter>
    );
  }
  return { ...rtlRender(ui, { ...rest, wrapper: Wrapper }), host };
}

/**
 * A rejection shaped like the app adapter's errors (a `PlatformApiError`),
 * with the reference app's `ApiError` constructor signature so the moved tests
 * read the way they did.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'PlatformApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Canned `GET /storage/objects/:id/download` answers (a signed URL) for these object ids. */
export function downloadResponses(ids: readonly string[]): Record<string, TestApiResponse> {
  return Object.fromEntries(
    ids.map((id) => [`GET /storage/objects/${id}/download`, { url: mockSignedUrl(id), expiresIn: 300 }]),
  );
}
