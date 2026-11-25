import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { render } from './render.js';
import { ActivationSuccess } from '../../src/identity/ui/device/ActivationSuccess.js';

describe('ActivationSuccess return URI', () => {
  const assign = vi.fn();
  const original = window.location;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    assign.mockReset();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } });
  });
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  it('follows a listed scheme after a successful approval, automatically and by button', async () => {
    render(<ActivationSuccess success message="ok" returnUri="myapp://paired?x=1" returnUriSchemes={['myapp']} deviceName="Phone A" />);
    const button = screen.getByRole('button', { name: 'Return to Phone A' });
    expect(screen.getByText('myapp://paired')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(assign).toHaveBeenCalledWith('myapp://paired?x=1');
    assign.mockReset();
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(button);
    expect(assign).toHaveBeenCalledWith('myapp://paired?x=1');
  });

  it('follows an https return URI without any configured scheme', async () => {
    render(<ActivationSuccess success message="ok" returnUri="https://app.example.test/paired" />);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(assign).toHaveBeenCalledWith('https://app.example.test/paired');
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'http://app.example.test', 'myapp://x'])(
    'never follows %s',
    async (returnUri) => {
      render(<ActivationSuccess success message="ok" returnUri={returnUri} />);
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(assign).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /^Return to/ })).toBeNull();
    },
  );

  it('does not follow after a denial', async () => {
    render(<ActivationSuccess success={false} message="denied" returnUri="https://app.example.test/paired" />);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(assign).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Return to/ })).toBeNull();
  });
});
