import type { OnboardingResponse, OnboardingStep } from '@marinoscar/platform-contract/onboarding';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { PlatformHostProvider } from '../../src/core/index.js';
import { OnboardingProvider } from '../../src/onboarding/headless/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiResponse, TestPlatformHost } from '../../src/testing/index.js';

export function step(id: string, extra: Partial<OnboardingStep> = {}): OnboardingStep {
  return {
    id,
    audience: id.startsWith('admin.') ? 'admin' : 'user',
    tier: 'optional',
    status: 'todo',
    title: `Title ${id}`,
    description: `Description ${id}`,
    actionLabel: 'Go',
    href: `/to/${id}`,
    detail: null,
    blockedReason: null,
    skippable: true,
    skipped: false,
    ...extra,
  };
}

export function response(extra: Partial<OnboardingResponse> = {}, settings: Partial<OnboardingResponse['settings']> = {}): OnboardingResponse {
  const userSteps = [step('user.profile', { status: 'done' }), step('user.notifications')];
  return {
    settings: { welcomeSeenAt: null, checklistDismissedAt: null, adminDismissedAt: null, skipped: [], ...settings },
    user: { steps: userSteps, completed: 1, total: 2, requiredDone: true, allResolved: false },
    admin: null,
    ...extra,
  };
}

export const ADMIN_BLOCK: OnboardingResponse['admin'] = {
  steps: [
    step('admin.storage', { tier: 'required', skippable: false, detail: 'Configure storage.' }),
    step('admin.email', { tier: 'required', skippable: false, status: 'done' }),
    step('admin.push', { tier: 'recommended' }),
  ],
  completed: 1,
  total: 3,
  requiredDone: false,
  allResolved: false,
};

function Where(): ReactElement {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

export function hostWith(responses: Record<string, TestApiResponse>, permissions: string[] = ['user_settings:read']): TestPlatformHost {
  return createTestPlatformHost({ permissions, responses });
}

export function renderWithOnboarding(host: TestPlatformHost, element: ReactElement, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PlatformHostProvider host={host}>
        <OnboardingProvider appName="Acme">
          <Routes>
            <Route path="*" element={<>{element}<Where /></>} />
          </Routes>
        </OnboardingProvider>
      </PlatformHostProvider>
    </MemoryRouter>,
  );
}

/** Canned answers that remember what PATCH /user-settings wrote, as the API would. */
export function stateful(base: OnboardingResponse): Record<string, TestApiResponse> {
  let settings: Record<string, unknown> = { ...base.settings };
  const current = () => ({ ...base, settings: settings as OnboardingResponse['settings'] });
  return {
    'GET /onboarding': current,
    'GET /onboarding?refresh=true': current,
    'GET /user-settings': { version: 1 },
    'PATCH /user-settings': (request) => {
      const patch = (request.body as { onboarding: Record<string, unknown> }).onboarding;
      settings = { ...settings };
      for (const [key, value] of Object.entries(patch)) settings[key] = value === null ? (key === 'skipped' ? [] : null) : value;
      return {};
    },
  };
}
