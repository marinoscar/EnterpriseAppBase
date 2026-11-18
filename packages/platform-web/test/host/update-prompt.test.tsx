import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { UpdatePrompt } from '../../src/host/ui/index.js';

/**
 * Issue #219, epic #215 (moved from the reference app by #901).
 *
 * `virtual:pwa-register/react` cannot be imported by the package (only the
 * app's bundler resolves it), so the prompt takes `useRegisterSW` as a prop and
 * these tests pass the double below: a REAL HOOK over real `useState`, because
 * the component writes back to the `[value, setValue]` tuples when the user
 * dismisses a prompt, and a double whose setters do nothing would make
 * dismissal untestable.
 *
 * The component is rendered BARE (no router, no auth, no theme provider),
 * deliberately, because the app mounts it outside `Routes` and outside
 * `ErrorBoundary`: it owns the service-worker registration and must run on
 * `/login` as much as anywhere else.
 */

const DEFAULTS = { needRefresh: false, offlineReady: false };
let initialState = { ...DEFAULTS };
const updateServiceWorkerMock = vi.fn<(reloadPage?: boolean) => Promise<void>>(() => Promise.resolve());

function useRegisterSW() {
  const needRefresh = useState(initialState.needRefresh);
  const offlineReady = useState(initialState.offlineReady);
  return { needRefresh, offlineReady, updateServiceWorker: updateServiceWorkerMock };
}

function setRegisterSWState(next: Partial<typeof DEFAULTS>): void {
  initialState = { ...initialState, ...next };
}

function resetRegisterSWMock(): void {
  initialState = { ...DEFAULTS };
  updateServiceWorkerMock.mockClear();
}

beforeEach(() => {
  resetRegisterSWMock();
});

describe('UpdatePrompt', () => {
  it('renders nothing at all when no update is waiting', () => {
    // THE LOAD-BEARING CASE. This component is mounted on every route, so if
    // its idle state were a hidden element or an empty Snackbar rather than
    // `null`, every page in the app would gain a stray node — and the
    // visual-regression suite (maxDiffPixels: 4) would be measuring a layout
    // that no longer matches the baselines.
    const { container } = render(<UpdatePrompt useRegisterSW={useRegisterSW} />);

    expect(container).toBeEmptyDOMElement();
    // MUI portals a Snackbar to document.body, so an empty container is not on
    // its own proof that nothing was rendered.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/new version/i)).not.toBeInTheDocument();
  });

  it('announces a waiting update', () => {
    setRegisterSWState({ needRefresh: true });

    render(<UpdatePrompt useRegisterSW={useRegisterSW} />);

    expect(screen.getByText('A new version is available')).toBeInTheDocument();
    // MUI's SnackbarContent carries role="alert", which is what makes the
    // message reach a screen reader without stealing focus from the page.
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('hands over to the waiting worker and reloads when Reload is clicked', async () => {
    const user = userEvent.setup();
    setRegisterSWState({ needRefresh: true });

    render(<UpdatePrompt useRegisterSW={useRegisterSW} />);
    await user.click(screen.getByRole('button', { name: 'Reload' }));

    // `true` is the whole point: it posts SKIP_WAITING to the waiting worker
    // (which `src/sw.ts` answers) AND reloads the page once it has taken
    // control. Called without it, the user clicks Reload and nothing happens.
    expect(updateServiceWorkerMock).toHaveBeenCalledWith(true);
  });

  it('lets the user dismiss the update notice without reloading', async () => {
    const user = userEvent.setup();
    setRegisterSWState({ needRefresh: true });

    render(<UpdatePrompt useRegisterSW={useRegisterSW} />);
    await user.click(screen.getByRole('button', { name: 'Dismiss update notice' }));

    expect(screen.queryByText('A new version is available')).not.toBeInTheDocument();
    expect(updateServiceWorkerMock).not.toHaveBeenCalled();
  });

  it('confirms offline readiness without offering a reload', () => {
    // The offline confirmation is an FYI about something that already
    // succeeded — there is nothing to reload into, so a Reload button here
    // would be a button that does nothing useful.
    setRegisterSWState({ offlineReady: true });

    render(<UpdatePrompt useRegisterSW={useRegisterSW} />);

    expect(screen.getByText('Ready to work offline')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
  });
});
