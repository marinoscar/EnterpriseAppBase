/**
 * PP-14.24b: an app adds its own notes to the packaged Getting started page
 * and Setup guide through their `slots`.
 *
 * `apps/web/src/platform-extensions/onboarding/OnboardingPageSlots.example.tsx`
 * is the example; this renders the REAL pages with it, and without, over a test
 * platform host shaped like the API.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OnboardingResponse, OnboardingStep } from '@marinoscar/platform-contract/onboarding';
import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import { OnboardingProvider } from '@marinoscar/platform-web/onboarding/headless';
import { GettingStartedPage, SetupGuidePage } from '@marinoscar/platform-web/onboarding/ui';
import { createTestPlatformHost } from '@marinoscar/platform-web/testing';

import { GETTING_STARTED_SLOTS, SETUP_GUIDE_SLOTS } from '../../../platform-extensions/onboarding/OnboardingPageSlots.example';

const step = (id: string, extra: Partial<OnboardingStep> = {}): OnboardingStep => ({
  id,
  audience: id.startsWith('admin.') ? 'admin' : 'user',
  tier: 'required',
  status: 'todo',
  title: `Title ${id}`,
  description: `Description ${id}`,
  actionLabel: 'Go',
  href: `/to/${id}`,
  detail: null,
  blockedReason: null,
  skippable: false,
  skipped: false,
  ...extra,
});

const RESPONSE: OnboardingResponse = {
  settings: { welcomeSeenAt: null, checklistDismissedAt: null, adminDismissedAt: null, skipped: [] },
  user: { steps: [step('user.profile')], completed: 0, total: 1, requiredDone: false, allResolved: false },
  admin: { steps: [step('admin.storage')], completed: 0, total: 1, requiredDone: false, allResolved: false },
};

function renderPage(element: JSX.Element) {
  const host = createTestPlatformHost({
    permissions: ['user_settings:read', 'system_settings:read'],
    responses: {
      'GET /onboarding': RESPONSE,
      'GET /admin/onboarding/metrics?days=30': { windowDays: 30, cohortSize: 0, milestones: [], steps: [] },
    },
  });
  return render(
    <MemoryRouter>
      <PlatformHostProvider host={host}>
        <OnboardingProvider appName="Example App">{element}</OnboardingProvider>
      </PlatformHostProvider>
    </MemoryRouter>,
  );
}

describe('the Getting started page with the app slots (PP-14.24b)', () => {
  it('draws the help note after the checklist and the welcome button', async () => {
    renderPage(<GettingStartedPage slots={GETTING_STARTED_SLOTS} />);
    const note = screen.getByText('Stuck on a step? Ask in the team channel.');
    const welcome = await screen.findByRole('button', { name: 'Show the welcome again' });
    expect(welcome.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is the page it always was with no slots', async () => {
    renderPage(<GettingStartedPage />);
    await screen.findByText('Title user.profile');
    expect(screen.queryByText(/Stuck on a step/)).toBeNull();
  });
});

describe('the Setup guide with the app slots (PP-14.24b)', () => {
  it('draws the freeze note under the header and above the buttons', async () => {
    renderPage(<SetupGuidePage slots={SETUP_GUIDE_SLOTS} />);
    const note = screen.getByText('Configuration changes are frozen on Fridays.');
    const recheck = screen.getByRole('button', { name: 'Re-check' });
    expect(note.compareDocumentPosition(recheck) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await screen.findByText('Title admin.storage');
  });

  it('is the page it always was with no slots', async () => {
    renderPage(<SetupGuidePage />);
    await screen.findByText('Title admin.storage');
    expect(screen.queryByText(/frozen on Fridays/)).toBeNull();
  });
});
