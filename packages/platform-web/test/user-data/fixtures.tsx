import type { UserDataSummary } from '@marinoscar/platform-contract/user-data';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { PlatformHostProvider } from '../../src/core/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiResponse, TestPlatformHost } from '../../src/testing/index.js';

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
