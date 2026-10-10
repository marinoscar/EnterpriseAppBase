/**
 * Issue #925 (PP-14.7): a storage driver an app registered shows up on the
 * admin storage page with no web code.
 *
 * The reference app registers `local-fs`
 * (apps/api/src/platform-extensions/storage/local-fs.driver.ts) with
 * `registerStorageDriver`. The API describes it in `GET /api/admin/storage-config`
 * (`descriptors`, `drivers`), and the packaged page draws a generated form from
 * that descriptor. Nothing is mocked but the network (MSW), so the test proves
 * the wire: selecting the driver and editing its one setting saves as
 * `{ provider: 'local-fs', drivers: { 'local-fs': { directory } } }`, "Test
 * connection" shows the driver's own message and details, and a driver that
 * declares a secret (`vault-blob`, invented for this test) takes it write-only
 * under `secrets.<id>.<name>`, never in the settings and never in the markup.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import StorageConfigPage from '@marinoscar/platform-web/storage/ui';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { storageConfigWithCustomDrivers } from '../../mocks/fixtures/storage';

const TYPED_SECRET = 'AccountKey=asm-example-secret-NEVER-RENDERED-0001';

interface Captured {
  method: string;
  path: string;
  body: Record<string, unknown>;
  ifMatch: string | null;
}

describe('local-fs on the admin storage page (#925)', () => {
  let captured: Captured[];
  const config = storageConfigWithCustomDrivers({ version: 4 });

  beforeEach(() => {
    server.resetHandlers();
    captured = [];
    const record = async (request: Request) => {
      const body = (await request.json()) as Record<string, unknown>;
      captured.push({ method: request.method, path: new URL(request.url).pathname, body, ifMatch: request.headers.get('If-Match') });
      return body;
    };
    server.use(
      http.get('*/api/admin/storage-config', () => HttpResponse.json({ data: config })),
      http.put('*/api/admin/storage-config', async ({ request }) => {
        const body = await record(request);
        return HttpResponse.json({
          data: { ...config, provider: body.provider, drivers: { ...config.drivers, ...(body.drivers as object) }, version: 5 },
        });
      }),
      http.post('*/api/admin/storage-config/test', async ({ request }) => {
        await record(request);
        return HttpResponse.json({
          data: {
            success: true,
            provider: 'local-fs',
            bucket: '/srv/objects',
            region: '',
            effectiveEndpoint: null,
            usedStoredSecret: false,
            checks: [],
            message: 'Wrote, read back and deleted a probe file.',
            details: { directory: '/srv/objects', writable: true },
            attemptedAt: '2026-01-01T00:00:00.000Z',
          },
        });
      }),
      http.post('*/api/admin/storage-config/bucket', async ({ request }) => {
        await record(request);
        return HttpResponse.json({
          data: {
            outcome: 'created',
            provider: 'local-fs',
            bucket: '/srv/objects',
            region: '',
            effectiveEndpoint: null,
            steps: [],
            message: 'Created /srv/objects.',
            guidance: null,
            corsOrigin: null,
            attemptedAt: '2026-01-01T00:00:00.000Z',
          },
        });
      }),
    );
  });

  async function renderPage() {
    const user = userEvent.setup();
    render(<StorageConfigPage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByRole('radio', { name: 'Local filesystem' });
    return user;
  }

  it('lists the driver beside the built-ins, labelled by the driver', async () => {
    await renderPage();

    const group = screen.getByRole('radiogroup', { name: 'Provider' });
    expect(within(group).getAllByRole('radio').map((el) => el.closest('label')?.textContent)).toEqual([
      'Amazon S3',
      'Cloudflare R2',
      'S3-compatible',
      'Local filesystem',
      'Vault Blob',
    ]);
  });

  it('selects the driver, edits its directory and saves { provider, drivers } with the loaded version', async () => {
    const user = await renderPage();

    await user.click(screen.getByRole('radio', { name: 'Local filesystem' }));
    const directory = screen.getByLabelText('Directory');
    expect(screen.getByText(/Absolute path of the folder/)).toBeInTheDocument();
    await user.type(directory, '/srv/objects');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(captured.filter((c) => c.method === 'PUT')).toHaveLength(1));
    const put = captured.find((c) => c.method === 'PUT')!;
    expect(put.body).toEqual({ provider: 'local-fs', drivers: { 'local-fs': { directory: '/srv/objects' } } });
    expect(put.ifMatch).toBe('4');
    expect(await screen.findByText('Storage configuration saved')).toBeInTheDocument();
  });

  it('tests the unsaved form and shows the driver\'s message and details', async () => {
    const user = await renderPage();

    await user.click(screen.getByRole('radio', { name: 'Local filesystem' }));
    await user.type(screen.getByLabelText('Directory'), '/srv/objects');
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    const result = await screen.findByTestId('storage-test-result');
    expect(within(result).getByTestId('storage-test-message')).toHaveTextContent('Wrote, read back and deleted a probe file.');
    expect(within(result).getByTestId('storage-test-details')).toHaveTextContent('/srv/objects');
    expect(result).toHaveTextContent('Storage is reachable and writable');
    const post = captured.find((c) => c.path.endsWith('/storage-config/test'))!;
    expect(post.body).toEqual({ provider: 'local-fs', drivers: { 'local-fs': { directory: '/srv/objects' } } });
  });

  it('shows what the driver answers to a provisioning request after a failed test', async () => {
    server.use(
      http.post('*/api/admin/storage-config/test', () =>
        HttpResponse.json({
          data: {
            success: false,
            provider: 'local-fs',
            bucket: '/srv/objects',
            region: '',
            effectiveEndpoint: null,
            usedStoredSecret: false,
            checks: [],
            message: 'The folder does not exist.',
            attemptedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
      ),
    );
    const user = await renderPage();

    await user.click(screen.getByRole('radio', { name: 'Local filesystem' }));
    await user.type(screen.getByLabelText('Directory'), '/srv/objects');
    await user.click(screen.getByRole('button', { name: /test connection/i }));
    expect(await screen.findByTestId('storage-test-message')).toHaveTextContent('The folder does not exist.');
    await user.click(await screen.findByTestId('storage-create-bucket'));

    expect(await screen.findByTestId('storage-bucket-message')).toHaveTextContent('Created /srv/objects.');
    expect(screen.getByTestId('storage-bucket-result')).toHaveTextContent('Bucket created and configured');
  });

  it('takes a secret write-only under secrets.<id>, outside the settings, and never renders it', async () => {
    const user = await renderPage();

    await user.click(screen.getByRole('radio', { name: 'Vault Blob' }));
    const secret = screen.getByLabelText(/Connection string/);
    expect(secret).toHaveAttribute('type', 'password');
    expect(secret).toHaveValue('');
    expect(secret).toBeRequired();
    await user.type(secret, TYPED_SECRET);
    expect(document.body.textContent).not.toContain(TYPED_SECRET);
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(captured.filter((c) => c.method === 'PUT')).toHaveLength(1));
    const put = captured.find((c) => c.method === 'PUT')!;
    expect(put.body.provider).toBe('vault-blob');
    expect(put.body.secrets).toEqual({ 'vault-blob': { connectionString: TYPED_SECRET } });
    expect(JSON.stringify(put.body.drivers)).not.toContain(TYPED_SECRET);
    // Cleared once the server has answered: the form is rebuilt from the response.
    await waitFor(() => expect(screen.getByLabelText(/Connection string/)).toHaveValue(''));
    expect(document.body.innerHTML).not.toContain(TYPED_SECRET);
  });

  it('leaves the built-in S3 form as it was', async () => {
    await renderPage();

    expect(screen.getByLabelText(/^bucket$/i)).toHaveValue('app-objects');
    expect(screen.getByLabelText(/secret access key/i)).toHaveAttribute('type', 'password');
    expect(screen.queryByTestId('storage-driver-panel-s3')).not.toBeInTheDocument();
  });
});
