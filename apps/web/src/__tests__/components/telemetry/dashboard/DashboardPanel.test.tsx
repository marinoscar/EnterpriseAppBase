/**
 * `DashboardPanel` (issue #578): the actions slot #579 plugs into, and the
 * per-panel states.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddIcon from '@mui/icons-material/Add';
import { render } from '../../../utils/test-utils';
import { resetViewportWidth, setViewportWidth } from '../../../setup';
import { DashboardPanel } from '../../../../components/telemetry/dashboard/DashboardPanel';

describe('DashboardPanel', () => {
  afterEach(() => act(() => resetViewportWidth()));

  it('renders actions as icon buttons that receive the panel SQL', async () => {
    const onClick = vi.fn();
    render(
      <DashboardPanel id="p" title="Panel" sql={['SELECT 1', 'SELECT 2']} actions={[{ key: 'a', label: 'Open in Explorer', icon: <AddIcon />, onClick }]}>
        body
      </DashboardPanel>,
    );
    expect(screen.getByRole('region', { name: 'Panel' })).toHaveTextContent('body');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open in Explorer' }));
    expect(onClick).toHaveBeenCalledWith(['SELECT 1', 'SELECT 2']);
  });

  it('folds actions into a menu on phones', async () => {
    act(() => setViewportWidth(390));
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <DashboardPanel id="p" title="Panel" sql="SELECT 1" actions={[{ key: 'a', label: 'Ask assistant', icon: <AddIcon />, onClick }]} />,
    );
    expect(screen.queryByRole('button', { name: 'Ask assistant' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Panel actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Ask assistant' }));
    expect(onClick).toHaveBeenCalledWith(['SELECT 1']);
  });

  it('renders no actions slot when there are none', () => {
    render(<DashboardPanel id="p" title="Panel">body</DashboardPanel>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows a skeleton, an empty message, or the error instead of the body', () => {
    const { rerender } = render(<DashboardPanel id="p" title="Panel" isLoading>body</DashboardPanel>);
    expect(screen.getByTestId('p-skeleton')).toBeInTheDocument();
    rerender(<DashboardPanel id="p" title="Panel" isEmpty emptyMessage="Nothing here">body</DashboardPanel>);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.queryByText('body')).not.toBeInTheDocument();
    rerender(
      <DashboardPanel
        id="p"
        title="Panel"
        error={{ message: 'nope', code: 'BAD_REQUEST', reason: 'TELEMETRY_DASHBOARD_BAD_FILTER', status: 400, sqlState: null, timeoutMs: null }}
      >
        body
      </DashboardPanel>,
    );
    expect(screen.getByText('nope')).toBeInTheDocument();
    expect(screen.getByText('TELEMETRY_DASHBOARD_BAD_FILTER')).toBeInTheDocument();
  });
});
