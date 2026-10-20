/**
 * AccountSignInProviderCard — issue #998.
 *
 * The card is presentational: the host owns enabling, consent, sign-in and
 * status, so each test drives it with props and `rerender`s the new status the
 * way a host would after an action resolves.
 */
import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
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

  // Issue #1003: the host can say why sign-in is not possible yet.
  describe('signInUnavailableReason', () => {
    const REASON = 'Install the Copilot CLI first';
    const signInName = `Sign in with ${NAME}`;
    const reasonNode = (
      <span data-testid="reason-node">
        Copilot CLI is missing. <a href="https://example.com/install">Install it</a>
      </span>
    );

    describe('set, signed out, enabled and consented', () => {
      const cases: [string, ReactNode][] = [
        ['a string', REASON],
        ['a ReactNode', reasonNode],
      ];

      it.each(cases)('disables the button, shows the reason and describes the button (%s)', (_label, reason) => {
        render(
          <AccountSignInProviderCard
            {...props({
              signInUnavailableReason: reason,
              consent: consent({ acceptedAt: '2026-01-01T00:00:00Z' }),
            })}
          />,
        );
        const button = screen.getByRole('button', { name: signInName });
        expect(button).toBeDisabled();

        const describedBy = button.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        const holder = document.getElementById(describedBy!);
        expect(holder).not.toBeNull();
        expect(holder).toBeVisible();
        if (typeof reason === 'string') {
          expect(holder).toHaveTextContent(reason);
          expect(screen.getByText(reason)).toBeVisible();
          expect(button).toHaveAccessibleDescription(reason);
        } else {
          expect(holder).toHaveTextContent('Copilot CLI is missing.');
          expect(within(holder!).getByRole('link', { name: 'Install it' })).toHaveAttribute(
            'href',
            'https://example.com/install',
          );
          expect(button).toHaveAccessibleDescription(/Copilot CLI is missing\. Install it/);
        }
      });

      it.each(cases)('does not call onSignIn when the disabled button is clicked (%s)', async (_label, reason) => {
        const onSignIn = vi.fn().mockResolvedValue(undefined);
        render(<AccountSignInProviderCard {...props({ onSignIn, signInUnavailableReason: reason })} />);
        // MUI sets pointer-events: none on a disabled button; click it anyway.
        await userEvent.setup({ pointerEventsCheck: 0 }).click(screen.getByRole('button', { name: signInName }));
        expect(onSignIn).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: signInName })).toBeDisabled();
      });
    });

    describe('unset (undefined), null or false', () => {
      const unset: [string, ReactNode][] = [
        ['undefined', undefined],
        ['null', null],
        ['false', false],
      ];

      it.each(unset)('keeps sign-in available (%s)', async (_label, reason) => {
        const onSignIn = vi.fn().mockResolvedValue(undefined);
        render(<AccountSignInProviderCard {...props({ onSignIn, signInUnavailableReason: reason })} />);
        const button = screen.getByRole('button', { name: signInName });
        expect(button).toBeEnabled();
        expect(button).not.toHaveAttribute('aria-describedby');
        expect(document.querySelector('[id$="signin-unavailable"]')).toBeNull();
        expect(button).toHaveAccessibleDescription('');

        await userEvent.click(button);
        await waitFor(() => expect(onSignIn).toHaveBeenCalledTimes(1));
      });
    });

    describe('signed in', () => {
      const signedIn = { signedIn: true, login: 'octocat' };

      it('ignores the reason: it is not shown and Sign out works', async () => {
        const onSignOut = vi.fn().mockResolvedValue(undefined);
        render(
          <AccountSignInProviderCard
            {...props({ status: signedIn, onSignOut, signInUnavailableReason: REASON })}
          />,
        );
        expect(screen.queryByText(REASON)).not.toBeInTheDocument();
        expect(document.querySelector('[id$="signin-unavailable"]')).toBeNull();
        expect(screen.getByText('Signed in as octocat')).toBeInTheDocument();

        const signOut = screen.getByRole('button', { name: 'Sign out' });
        expect(signOut).toBeEnabled();
        expect(signOut).not.toHaveAttribute('aria-describedby');
        await userEvent.click(signOut);
        await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
      });

      it('ignores the reason: Withdraw consent works', async () => {
        const onRevoke = vi.fn().mockResolvedValue(undefined);
        const c = consent({ acceptedAt: '2026-01-01T00:00:00Z', onRevoke });
        render(
          <AccountSignInProviderCard {...props({ status: signedIn, consent: c, signInUnavailableReason: REASON })} />,
        );
        expect(screen.queryByText(REASON)).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Withdraw consent' }));
        await waitFor(() => expect(onRevoke).toHaveBeenCalledTimes(1));
      });
    });

    describe('Try again', () => {
      it('retries a failed sign-out (another kind of action) while the reason is set', async () => {
        const onSignOut = vi
          .fn()
          .mockRejectedValueOnce(new Error('Sign-out refused'))
          .mockResolvedValue(undefined);
        const onSignIn = vi.fn().mockResolvedValue(undefined);
        render(
          <AccountSignInProviderCard
            {...props({
              status: { signedIn: true, login: 'octocat' },
              onSignOut,
              onSignIn,
              signInUnavailableReason: REASON,
            })}
          />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Sign-out refused');

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(2));
        expect(onSignIn).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
      });

      it('retries a failed model change while the reason is set', async () => {
        const onModelChange = vi
          .fn()
          .mockRejectedValueOnce(new Error('Model unavailable'))
          .mockResolvedValue(undefined);
        const onSignIn = vi.fn().mockResolvedValue(undefined);
        render(
          <AccountSignInProviderCard
            {...props({
              status: { signedIn: true, login: 'octocat' },
              models: [
                { id: 'm1', label: 'Model One' },
                { id: 'm2', label: 'Model Two' },
              ],
              model: 'm1',
              onModelChange,
              onSignIn,
              signInUnavailableReason: REASON,
            })}
          />,
        );
        await userEvent.click(screen.getByRole('combobox', { name: 'Model' }));
        await userEvent.click(await screen.findByRole('option', { name: 'Model Two' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Model unavailable');

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(onModelChange).toHaveBeenCalledTimes(2));
        expect(onModelChange).toHaveBeenLastCalledWith('m2');
        expect(onSignIn).not.toHaveBeenCalled();
      });

      it('retries a failed enable-switch change while signed out with the reason set', async () => {
        const onEnabledChange = vi
          .fn()
          .mockRejectedValueOnce(new Error('Could not save'))
          .mockResolvedValue(undefined);
        const onSignIn = vi.fn().mockResolvedValue(undefined);
        render(
          <AccountSignInProviderCard {...props({ onEnabledChange, onSignIn, signInUnavailableReason: REASON })} />,
        );
        await userEvent.click(screen.getByLabelText(`Enable ${NAME}`));
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(onEnabledChange).toHaveBeenCalledTimes(2));
        expect(onEnabledChange).toHaveBeenLastCalledWith(false);
        expect(onSignIn).not.toHaveBeenCalled();
      });

      it('does not re-run a sign-in that failed once the host sets the reason', async () => {
        const onSignIn = vi.fn().mockRejectedValue(new Error('Device flow expired'));
        const base = props({ onSignIn });
        const { rerender } = render(<AccountSignInProviderCard {...base} />);

        await userEvent.click(screen.getByRole('button', { name: signInName }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Device flow expired');
        expect(onSignIn).toHaveBeenCalledTimes(1);

        rerender(<AccountSignInProviderCard {...base} signInUnavailableReason={REASON} />);
        expect(screen.getByRole('button', { name: signInName })).toBeDisabled();

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onSignIn).toHaveBeenCalledTimes(1);
      });

      it('does not start a sign-in for a status error while the reason is set', async () => {
        const onSignIn = vi.fn().mockResolvedValue(undefined);
        render(
          <AccountSignInProviderCard
            {...props({
              onSignIn,
              status: { signedIn: false, error: 'Session expired' },
              signInUnavailableReason: REASON,
            })}
          />,
        );
        expect(screen.getByRole('alert')).toHaveTextContent('Session expired');
        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onSignIn).not.toHaveBeenCalled();
      });

      it('still starts a sign-in for a status error when no reason is set', async () => {
        const onSignIn = vi.fn().mockResolvedValue(undefined);
        render(
          <AccountSignInProviderCard
            {...props({ onSignIn, status: { signedIn: false, error: 'Session expired' } })}
          />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(onSignIn).toHaveBeenCalledTimes(1));
      });

      it.each([
        ['set', REASON],
        ['unset', undefined],
      ])('calls onRefreshStatus when it is given and the reason is %s', async (_label, reason) => {
        const onRefreshStatus = vi.fn().mockResolvedValue(undefined);
        const onSignIn = vi.fn().mockResolvedValue(undefined);
        render(
          <AccountSignInProviderCard
            {...props({
              onSignIn,
              onRefreshStatus,
              status: { signedIn: false, error: 'Session expired' },
              signInUnavailableReason: reason,
            })}
          />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(onRefreshStatus).toHaveBeenCalledTimes(1));
        expect(onSignIn).not.toHaveBeenCalled();
      });
    });

    it('re-enables the button and removes the reason when the host turns it off again', () => {
      const base = props();
      const { rerender } = render(<AccountSignInProviderCard {...base} signInUnavailableReason={REASON} />);
      expect(screen.getByRole('button', { name: signInName })).toBeDisabled();
      expect(screen.getByText(REASON)).toBeInTheDocument();

      rerender(<AccountSignInProviderCard {...base} signInUnavailableReason={undefined} />);
      const button = screen.getByRole('button', { name: signInName });
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('aria-describedby');
      expect(screen.queryByText(REASON)).not.toBeInTheDocument();
    });
  });
});
