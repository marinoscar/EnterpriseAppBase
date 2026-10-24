/**
 * PP-14.19: `registerNodeVital` in the reference app. The app registers how an
 * executor's `vitals.extra` keys read (src/platform-extensions/nodes/transcode.vitals.ts)
 * and the packaged Worker Nodes page's vitals dialog prints them, with no edit
 * under packages/. The page is rendered through the app's own DataTable, with
 * the fleet hooks mocked as WorkersPage.test.tsx does.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  installLayoutStubs,
  resetContainerWidth,
  setInitialContainerWidth,
} from '@marinoscar/platform-web/datatable/testing';
import type { WorkerNode } from '@marinoscar/platform-web/nodes/headless';

import { mockAdminUser, render } from '../../utils/test-utils';
import { registerTranscodeVitals } from '../../../platform-extensions/nodes/transcode.vitals';

vi.mock('@marinoscar/platform-web/nodes/headless', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@marinoscar/platform-web/nodes/headless')>();
  return {
    ...actual,
    useWorkerNodes: vi.fn(),
    useNodeCredentials: vi.fn(),
    useNodeActions: vi.fn(),
    useVisiblePolling: vi.fn(),
  };
});

import { useNodeActions, useNodeCredentials, useWorkerNodes } from '@marinoscar/platform-web/nodes/headless';
import { WorkersPage } from '@marinoscar/platform-web/nodes/ui';

const NODE: WorkerNode = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'transcoder-1',
  hostname: 'media-box-01',
  platform: 'linux-x64',
  cliVersion: '1.4.0',
  eligibleTypes: ['example.transcode'],
  concurrency: 2,
  status: 'online',
  health: 'healthy',
  capabilities: { probe: { capabilities: ['binary:ffmpeg'], versions: { ffmpeg: 'ffmpeg version 6.1' } } },
  registeredAt: '2026-01-01T00:00:00.000Z',
  lastHeartbeatAt: '2026-01-01T11:59:00.000Z',
  owner: { id: 'u1', email: 'ops@example.com', name: 'Ops' },
  jobCounts: { running: 1, pending: 0, succeeded: 4, failed: 0, total: 5 },
  lastVitals: { cpuPercent: 12, slotsUsed: 1, slotsTotal: 2, extra: { 'transcode.active': 1, 'transcode.frames': 12345, 'gpu.temperature_c': 61 } },
  lastVitalsAt: '2026-01-01T11:59:00.000Z',
};

async function openVitals() {
  const user = userEvent.setup();
  vi.mocked(useWorkerNodes).mockReturnValue({ nodes: [NODE], isLoading: false, error: null, refresh: vi.fn() });
  vi.mocked(useNodeCredentials).mockReturnValue({ credentials: [], isLoading: false, error: null, refresh: vi.fn() });
  vi.mocked(useNodeActions).mockReturnValue({
    isWorking: false,
    error: null,
    clearError: vi.fn(),
    removeNode: vi.fn(),
    createCredential: vi.fn(),
    revokeCredential: vi.fn(),
  });
  setInitialContainerWidth(1400);
  render(<WorkersPage />, { wrapperOptions: { user: { ...mockAdminUser, permissions: ['nodes:read'] } } });

  await user.click(await screen.findByRole('button', { name: `View vitals for ${NODE.name} (${NODE.hostname})` }));
  return screen.findByRole('dialog', { name: `Vitals — ${NODE.name} (${NODE.hostname})` });
}

describe('registerNodeVital: the transcode executor’s app vitals', () => {
  beforeAll(() => installLayoutStubs());
  beforeEach(() => resetContainerWidth(1400));
  afterAll(() => resetContainerWidth(1400));

  it('prints registered keys under their labels, and an unregistered key by its key', async () => {
    registerTranscodeVitals();
    const dialog = await openVitals();
    const table = within(dialog).getByRole('table', { name: 'App vitals' });
    const cell = (label: string) => within(within(table).getByRole('rowheader', { name: label }).closest('tr')!).getAllByRole('cell')[0];

    expect(cell('Transcodes running')).toHaveTextContent('1');
    expect(cell('Frames transcoded')).toHaveTextContent('12,345');
    // A key nobody registered is still shown: a node must never report something the page hides.
    expect(cell('gpu.temperature_c')).toHaveTextContent('61');
  });

  it('lists the node’s probed capabilities with the version it captured', async () => {
    const dialog = await openVitals();

    expect(within(dialog).getByTestId('node-capabilities')).toHaveTextContent('binary:ffmpeg — ffmpeg version 6.1');
  });
});
