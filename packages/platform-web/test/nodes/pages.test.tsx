// The packaged Worker Nodes page without the reference app (issue #881): over a
// test platform host (the default `createNodesApi(host.api)` client), the
// fallback MUI table and spinner, the viewer's permissions, the header slot and
// the compatibility paths of the jobs slice (re-export, adapter bridge).

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { PlatformHostProvider } from '../../src/core/index.js';
import { JobsWebAdaptersProvider } from '../../src/jobs/headless/index.js';
import type { JobsApi } from '../../src/jobs/headless/index.js';
import { WorkersPage as JobsWorkersPage } from '../../src/jobs/ui/index.js';
import { NodesWebAdaptersProvider } from '../../src/nodes/headless/index.js';
import { WorkersPage } from '../../src/nodes/ui/index.js';
import type { NodesPageHeaderProps } from '../../src/nodes/ui/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import type { TestPlatformHost } from '../../src/testing/index.js';
import { credential, fakeNodesApi, node } from './harness.js';

function renderAt(ui: ReactElement, host: TestPlatformHost) {
  return render(
    <MemoryRouter initialEntries={['/page']}>
      <ThemeProvider theme={createTheme()}>
        <PlatformHostProvider host={host}>
          <Routes>
            <Route path="/page" element={ui} />
            <Route path="/" element={<p>home</p>} />
          </Routes>
        </PlatformHostProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

function CustomHeader({ title, readOnly }: NodesPageHeaderProps) {
  return <h1>{`${title} custom${readOnly ? ' ro' : ''}`}</h1>;
}

describe('WorkersPage', () => {
  const responses = {
    'GET /admin/nodes': [node()],
    'GET /admin/nodes/credentials': [credential()],
  };

  it('renders the fleet and the credentials', async () => {
    const host = createTestPlatformHost({ permissions: ['nodes:read', 'nodes:write'], responses });
    renderAt(<WorkersPage />, host);

    expect(screen.getByRole('heading', { level: 1, name: 'Worker Nodes' })).toBeInTheDocument();
    const fleet = await screen.findByRole('table', { name: 'Worker nodes' });
    await waitFor(() => expect(within(fleet).getByText('worker-a')).toBeInTheDocument());
    expect(await screen.findByText('nod_1a2b…')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Delete node' })).toHaveLength(1);
  });

  it('offers no write action without nodes:write', async () => {
    const host = createTestPlatformHost({ permissions: ['nodes:read'], responses });
    renderAt(<WorkersPage />, host);

    await screen.findByRole('table', { name: 'Worker nodes' });
    expect(screen.queryByRole('button', { name: 'Delete node' })).not.toBeInTheDocument();
    expect(screen.getByText(/\(read-only\)/)).toBeInTheDocument();
  });

  it('redirects a viewer without nodes:read', async () => {
    const host = createTestPlatformHost({ permissions: ['jobs:read'], responses });
    renderAt(<WorkersPage />, host);
    expect(await screen.findByText('home')).toBeInTheDocument();
  });

  it('replaces the header through the slot', async () => {
    const host = createTestPlatformHost({ permissions: ['nodes:read'], responses });
    renderAt(<WorkersPage slots={{ Header: CustomHeader }} />, host);
    expect(await screen.findByRole('heading', { level: 1, name: 'Worker Nodes custom ro' })).toBeInTheDocument();
  });

  it('is the page the jobs entry re-exports', () => {
    expect(JobsWorkersPage).toBe(WorkersPage);
  });

  it('reads the client from the nodes adapters', async () => {
    const api = fakeNodesApi();
    api.getWorkerNodes.mockResolvedValue([node({ name: 'from-adapter' })]);
    api.getNodeCredentials.mockResolvedValue([]);
    const host = createTestPlatformHost({ permissions: ['nodes:read'] });
    renderAt(
      <NodesWebAdaptersProvider adapters={{ api }}>
        <WorkersPage />
      </NodesWebAdaptersProvider>,
      host,
    );
    expect(await screen.findByText('from-adapter')).toBeInTheDocument();
    expect(api.getWorkerNodes).toHaveBeenCalled();
  });

  it('is fed by the jobs adapters an app already wired (the compatibility bridge)', async () => {
    // A jobs client has the nodes members too; only those are exercised here.
    const fake = fakeNodesApi();
    fake.getWorkerNodes.mockResolvedValue([node({ name: 'from-jobs-adapter' })]);
    fake.getNodeCredentials.mockResolvedValue([]);
    const api = fake as unknown as JobsApi;
    const host = createTestPlatformHost({ permissions: ['nodes:read'] });
    renderAt(
      <JobsWebAdaptersProvider adapters={{ api }}>
        <WorkersPage />
      </JobsWebAdaptersProvider>,
      host,
    );
    expect(await screen.findByText('from-jobs-adapter')).toBeInTheDocument();
  });
});
