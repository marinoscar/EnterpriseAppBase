import type { UserDataSummary } from '@marinoscar/platform-contract/user-data';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { PlatformHostProvider } from '../../src/core/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiResponse, TestPlatformHost } from '../../src/testing/index.js';

/**
 * The lists the summary routes return (PP-14.24): the platform's own lines,
 * which are the text the pages printed before the lists came from the API.
 */
export const LISTS = {
  user: {
    kept: [
      'Your account, your sign-in identities and your roles',
      'Your organization and group memberships',
      'This browser session (you stay signed in)',
      'The audit log',
    ],
  },
  reset: {
    deleted: [
      'Every other user, their sessions and their access tokens',
      "Every user's data, yours included",
      'Job history, broadcasts, device logins and the allowlist (except your own entry)',
      'Every stored file except database backups',
      'Every organization except the default one',
    ],
    kept: [
      'Your account and this session',
      'Roles and permissions',
      'Configuration: system settings, storage, email and AI credentials, AI models',
      'Database backups, their files and their jobs',
      'Worker nodes (reassigned to you)',
      'The audit log',
    ],
  },
};

export const SUMMARY: UserDataSummary = {
  categories: [
    { id: 'files', label: 'Files', description: 'Uploads.', content: true, count: 2, bytes: 2048 },
    { id: 'transcripts', label: 'Transcripts', description: 'Audio.', content: true, count: 0, bytes: null },
    { id: 'notes', label: 'Notes', description: 'Notes.', content: true, count: 3, bytes: null },
    { id: 'credentials', label: 'Access tokens', description: 'Tokens.', content: false, count: 1, bytes: null },
  ],
  scopes: [
    { id: 'transcripts', label: 'Delete my transcripts', description: 'Every transcript.', layer: 'specific', confirmation: 'TRANSCRIPTS', categories: ['transcripts'] },
    { id: 'notes', label: 'Delete my notes', description: 'Every note.', layer: 'specific', confirmation: 'NOTES', categories: ['notes'] },
    { id: 'content', label: 'Delete my content', description: 'Content.', layer: 'danger', confirmation: 'DELETE MY CONTENT', categories: ['files', 'transcripts', 'notes'] },
    { id: 'everything', label: 'Delete all my data', description: 'All.', layer: 'danger', confirmation: 'DELETE MY DATA', categories: ['files', 'transcripts', 'notes', 'credentials'] },
  ],
  ...LISTS.user,
};

export function hostWith(responses: Record<string, TestApiResponse>, permissions: string[] = []): TestPlatformHost {
  return createTestPlatformHost({ permissions, responses });
}

export function renderWithHost(host: TestPlatformHost, element: ReactElement) {
  return render(
    <MemoryRouter>
      <PlatformHostProvider host={host}>{element}</PlatformHostProvider>
    </MemoryRouter>,
  );
}
