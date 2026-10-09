// The AI feature route guard (#899): a spinner while the first answer is in
// flight, the children when AI is on, a redirect (or the fallback) when off.
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { RequireAiEnabled } from '../../src/ai/ui/require-ai-enabled.js';
import { render } from './harness.js';

function guarded(fallback?: React.ReactNode) {
  return (
    <Routes>
      <Route path="/" element={<div>home</div>} />
      <Route
        path="/ai"
        element={
          <RequireAiEnabled {...(fallback === undefined ? {} : { fallback })}>
            <div>guarded page</div>
          </RequireAiEnabled>
        }
      />
    </Routes>
  );
}

describe('RequireAiEnabled', () => {
  it('renders the children while AI is on', () => {
    render(guarded(), { wrapperOptions: { route: '/ai', aiEnabled: true } });
    expect(screen.getByText('guarded page')).toBeInTheDocument();
  });

  it('redirects to / while AI is off', () => {
    render(guarded(), { wrapperOptions: { route: '/ai', aiEnabled: false } });
    expect(screen.getByText('home')).toBeInTheDocument();
    expect(screen.queryByText('guarded page')).not.toBeInTheDocument();
  });

  it('renders the fallback instead of redirecting when given one', () => {
    render(guarded(<div>not available</div>), { wrapperOptions: { route: '/ai', aiEnabled: false } });
    expect(screen.getByText('not available')).toBeInTheDocument();
  });

  it('shows a spinner, not the fallback, while the first answer is in flight', () => {
    render(guarded(), {
      wrapperOptions: { route: '/ai' },
      responses: { 'GET /ai/config': new Promise(() => undefined) as never },
    });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('home')).not.toBeInTheDocument();
  });
});
