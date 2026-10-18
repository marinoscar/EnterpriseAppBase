/**
 * AccountSignInProviderCard — issue #998.
 *
 * The card is presentational: the host owns enabling, consent, sign-in and
 * status, so each test drives it with props and `rerender`s the new status the
 * way a host would after an action resolves.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../harness.js';
import { AccountSignInProviderCard } from '../../../src/ai/ui/user/AccountSignInProviderCard.js';
import type { AccountSignInProviderCardProps } from '../../../src/ai/ui/user/AccountSignInProviderCard.js';

const NAME = 'Copilot';

function props(overrides: Partial<AccountSignInProviderCardProps> = {}): AccountSignInProviderCardProps {
  return {
    provider: { id: 'copilot', displayName: NAME, description: 'Uses your Copilot account' },
    enabled: true,
    onEnabledChange: vi.fn().mockResolvedValue(undefined),
    status: { signedIn: false },
    onSignIn: vi.fn().mockResolvedValue(undefined),
    onSignOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const consent = (overrides: Record<string, unknown> = {}) => ({
  required: true,
  acceptedAt: null,
  title: 'Allow Copilot access',
  body: 'Prompts are sent to GitHub.',
  onAccept: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

/** A promise the test settles by hand, to observe a pending action. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('AccountSignInProviderCard', () => {
  it('renders a named section with title and description', () => {
    render(<AccountSignInProviderCard {...props()} />);
    const section = screen.getByRole('region', { name: `${NAME} sign-in` });
    expect(within(section).getByRole('heading', { name: NAME })).toBeInTheDocument();
    expect(within(section).getByText('Uses your Copilot account')).toBeInTheDocument();
  });

  describe('disabled', () => {
    it('shows only the title, description and toggle', () => {
      render(
        <AccountSignInProviderCard
          {...props({
            enabled: false,
            status: { signedIn: true, login: 'octocat' },
            onRefreshStatus: vi.fn(),
            capabilities: [{ label: 'Chat', available: true }],
            consent: consent(),
          })}
        />,
      );
      expect(screen.getByText(NAME)).toBeInTheDocument();
      expect(screen.getByLabelText(`Enable ${NAME}`)).not.toBeChecked();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByText(/Signed in/)).not.toBeInTheDocument();
      expect(screen.queryByText('Chat')).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('calls onEnabledChange(true) when switched on', async () => {
      const onEnabledChange = vi.fn().mockResolvedValue(undefined);
      render(<AccountSignInProviderCard {...props({ enabled: false, onEnabledChange })} />);
      await userEvent.click(screen.getByLabelText(`Enable ${NAME}`));
      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith(true));
    });
  });

  it('calls onEnabledChange(false) when switched off', async () => {
    const onEnabledChange = vi.fn().mockResolvedValue(undefined);
    render(<AccountSignInProviderCard {...props({ onEnabledChange })} />);
    const toggle = screen.getByLabelText(`Enable ${NAME}`);
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith(false));
  });

  describe('consent', () => {
    it('blocks with a dialog and offers no sign-in button until the user agrees', () => {
      render(<AccountSignInProviderCard {...props({ consent: consent() })} />);
      const dialog = screen.getByRole('dialog', { name: 'Allow Copilot access' });
      expect(within(dialog).getByText('Prompts are sent to GitHub.')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'I agree' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: `Sign in with ${NAME}` })).not.toBeInTheDocument();
    });

    it('calls onAccept exactly once on I agree', async () => {
      const c = consent();
      render(<AccountSignInProviderCard {...props({ consent: c })} />);
      await userEvent.click(screen.getByRole('button', { name: 'I agree' }));
      await waitFor(() => expect(c.onAccept).toHaveBeenCalledTimes(1));
    });

    it('uses acceptLabel for the accept button', () => {
      render(<AccountSignInProviderCard {...props({ consent: consent({ acceptLabel: 'Allow it' }) })} />);
      expect(screen.getByRole('button', { name: 'Allow it' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'I agree' })).not.toBeInTheDocument();
    });

    it('turns the provider off on Not now', async () => {
      const onEnabledChange = vi.fn().mockResolvedValue(undefined);
      const c = consent();
      render(<AccountSignInProviderCard {...props({ consent: c, onEnabledChange })} />);
      await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith(false));
      expect(c.onAccept).not.toHaveBeenCalled();
    });

    it('shows the sign-in button once consent has been given', () => {
      render(
        <AccountSignInProviderCard {...props({ consent: consent({ acceptedAt: '2026-01-01T00:00:00Z' }) })} />,
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Sign in with ${NAME}` })).toBeInTheDocument();
    });

    it('does not ask when consent is not required', () => {
      render(<AccountSignInProviderCard {...props({ consent: consent({ required: false }) })} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Sign in with ${NAME}` })).toBeInTheDocument();
    });
  });

  describe('sign in', () => {
    it('is busy while pending, then shows the signed-in chip with the login', async () => {
      const d = deferred();
      const onSignIn = vi.fn().mockReturnValue(d.promise);
      const base = props({ onSignIn });
      const { rerender } = render(<AccountSignInProviderCard {...base} />);

      await userEvent.click(screen.getByRole('button', { name: `Sign in with ${NAME}` }));
      const busy = await screen.findByRole('button', { name: 'Signing in…' });
      expect(busy).toBeDisabled();
      expect(onSignIn).toHaveBeenCalledTimes(1);

      d.resolve();
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Signing in…' })).not.toBeInTheDocument());

      rerender(<AccountSignInProviderCard {...base} status={{ signedIn: true, login: 'octocat' }} />);
      expect(screen.getByText('Signed in as octocat')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: `Sign in with ${NAME}` })).not.toBeInTheDocument();
    });

    it('shows a worded error from a rejected sign-in with Try again, which retries', async () => {
      const onSignIn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Device flow expired'))
        .mockResolvedValue(undefined);
      render(<AccountSignInProviderCard {...props({ onSignIn })} />);

      await userEvent.click(screen.getByRole('button', { name: `Sign in with ${NAME}` }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Device flow expired');

      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(onSignIn).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });

    it('falls back to the default text when the rejection has no message', async () => {
      const onSignIn = vi.fn().mockRejectedValue('nope');
      render(<AccountSignInProviderCard {...props({ onSignIn })} />);
      await userEvent.click(screen.getByRole('button', { name: `Sign in with ${NAME}` }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in failed');
    });
  });

  describe('signed in', () => {
    const signedIn = { signedIn: true, login: 'octocat' };

    it('sign out is busy while pending, then returns to signed out', async () => {
      const d = deferred();
      const onSignOut = vi.fn().mockReturnValue(d.promise);
      const base = props({ status: signedIn, onSignOut });
      const { rerender } = render(<AccountSignInProviderCard {...base} />);

      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      expect(await screen.findByRole('button', { name: 'Signing out…' })).toBeDisabled();
      expect(onSignOut).toHaveBeenCalledTimes(1);

      d.resolve();
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Signing out…' })).not.toBeInTheDocument());

      rerender(<AccountSignInProviderCard {...base} status={{ signedIn: false }} />);
      expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Sign in with ${NAME}` })).toBeInTheDocument();
    });

    it('lists capabilities with availability chips and notes', () => {
      render(
        <AccountSignInProviderCard
          {...props({
            status: signedIn,
            capabilities: [
              { label: 'Chat', available: true },
              { label: 'Embeddings', available: false, note: 'Not offered by this plan' },
            ],
          })}
        />,
      );
      const list = screen.getByRole('list', { name: `${NAME} capabilities` });
      const items = within(list).getAllByRole('listitem');
      expect(items).toHaveLength(2);
      expect(within(items[0]!).getByText('Chat')).toBeInTheDocument();
      expect(within(items[0]!).getByText('Available')).toBeInTheDocument();
      expect(within(items[1]!).getByText('Embeddings')).toBeInTheDocument();
      expect(within(items[1]!).getByText('Not available')).toBeInTheDocument();
      expect(within(items[1]!).getByText('Not offered by this plan')).toBeInTheDocument();
    });

    it('renders the model select and reports a change', async () => {
      const onModelChange = vi.fn().mockResolvedValue(undefined);
      render(
        <AccountSignInProviderCard
          {...props({
            status: signedIn,
            models: [
              { id: 'm1', label: 'Model One' },
              { id: 'm2', label: 'Model Two' },
            ],
            model: 'm1',
            onModelChange,
          })}
        />,
      );
      const select = screen.getByRole('combobox', { name: 'Model' });
      expect(select).toHaveTextContent('Model One');
      await userEvent.click(select);
      await userEvent.click(await screen.findByRole('option', { name: 'Model Two' }));
      await waitFor(() => expect(onModelChange).toHaveBeenCalledWith('m2'));
    });

    it('omits the model select when no models are given', () => {
      render(<AccountSignInProviderCard {...props({ status: signedIn })} />);
      expect(screen.queryByRole('combobox', { name: 'Model' })).not.toBeInTheDocument();
    });
  });

  describe('status', () => {
    it('renders status.error in an alert with Try again', () => {
      render(<AccountSignInProviderCard {...props({ status: { signedIn: false, error: 'Session expired' } })} />);
      expect(screen.getByRole('alert')).toHaveTextContent('Session expired');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

    it('shows no alert without an error', () => {
      render(<AccountSignInProviderCard {...props()} />);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('offers Check status only when onRefreshStatus is given, and calls it', async () => {
      const { unmount } = render(<AccountSignInProviderCard {...props()} />);
      expect(screen.queryByRole('button', { name: 'Check status' })).not.toBeInTheDocument();
      unmount();

      const onRefreshStatus = vi.fn().mockResolvedValue(undefined);
      render(<AccountSignInProviderCard {...props({ onRefreshStatus })} />);
      await userEvent.click(screen.getByRole('button', { name: 'Check status' }));
      await waitFor(() => expect(onRefreshStatus).toHaveBeenCalledTimes(1));
    });
  });
});
