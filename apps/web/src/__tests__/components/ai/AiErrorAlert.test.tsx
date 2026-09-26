import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../../utils/test-utils';
import { AiErrorAlert, AI_KEYS_PATH, aiErrorCopy } from '../../../components/ai/AiErrorAlert';
import { AiConfigContext, type UseAiConfigReturn } from '../../../hooks/useAiConfig';
import { mockAiPublicConfigEnabled } from '../../mocks/fixtures/ai';
import type { AiErrorInfo } from '../../../services/aiErrors';

/**
 * `AiErrorAlert` — issue #434. The single code → copy mapping every AI
 * surface renders through: each code gets its own title, and the two key
 * codes link to `/settings/ai`.
 */

function renderAlert(error: AiErrorInfo, refresh = vi.fn().mockResolvedValue(undefined)) {
  const value: UseAiConfigReturn = {
    config: mockAiPublicConfigEnabled,
    isLoading: false,
    error: null,
    refresh,
  };
  render(
    <AiConfigContext.Provider value={value}>
      <AiErrorAlert error={error} />
    </AiConfigContext.Provider>,
  );
  return { refresh };
}

const CASES: { code: string; title: string; link: boolean }[] = [
  { code: 'AI_KEY_REQUIRED', title: 'Add your API key', link: true },
  { code: 'AI_KEY_INVALID', title: 'Your key was rejected by the provider', link: true },
  { code: 'AI_MODEL_NOT_ENABLED', title: "This model isn't available to you", link: false },
  { code: 'AI_MODEL_NOT_REACHABLE', title: "This model isn't available to you", link: true },
  { code: 'AI_DISABLED', title: 'AI is disabled by your administrator', link: false },
  { code: 'AI_CONTENT_FILTERED', title: 'Blocked by the content filter', link: false },
  { code: 'AI_PROVIDER_UNAVAILABLE', title: 'The provider is unavailable', link: false },
  { code: 'AI_STRUCTURED_OUTPUT_INVALID', title: "The answer didn't match the schema", link: false },
  { code: 'AI_PROVIDER_DISABLED', title: 'This provider is disabled', link: false },
  { code: 'AI_CAPABILITY_UNSUPPORTED', title: "This model can't do that", link: false },
  { code: 'AI_INVALID_REQUEST', title: 'The request was invalid', link: false },
  { code: 'AI_TOOL_DISABLED', title: "This tool isn't enabled", link: false },
];

describe('AiErrorAlert', () => {
  it.each(CASES)('renders the specific copy for $code', ({ code, title, link }) => {
    renderAlert({ code, message: 'server message' });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-ai-error-code', code);
    expect(screen.getByText(title)).toBeInTheDocument();

    const action = screen.queryByRole('link');
    if (link) {
      expect(action).toHaveAttribute('href', AI_KEYS_PATH);
    } else {
      expect(action).not.toBeInTheDocument();
    }
  });

  it('turns retryAfterMs into whole seconds for AI_RATE_LIMITED', () => {
    renderAlert({ code: 'AI_RATE_LIMITED', message: 'slow down', retryAfterMs: 12_300 });
    expect(screen.getByText('Provider rate limit — retry in 13 s')).toBeInTheDocument();
  });

  it('says "retry shortly" when the provider gave no back-off hint', () => {
    renderAlert({ code: 'AI_RATE_LIMITED', message: 'slow down' });
    expect(screen.getByText('Provider rate limit — retry shortly')).toBeInTheDocument();
  });

  it('asks the shell to re-read the AI config on AI_DISABLED', () => {
    const { refresh } = renderAlert({ code: 'AI_DISABLED', message: 'AI is disabled' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh the AI config for any other code', () => {
    const { refresh } = renderAlert({ code: 'AI_KEY_REQUIRED', message: 'x' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('falls back to a generic title plus the server message for an unknown or missing code', () => {
    renderAlert({ code: null, message: 'Network exploded' });
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Network exploded')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveAttribute('data-ai-error-code', 'unknown');
  });

  it('shows the server detail under the mapped copy', () => {
    renderAlert({ code: 'AI_CONTENT_FILTERED', message: 'Flagged: violence' });
    expect(screen.getByText('Flagged: violence')).toBeInTheDocument();
  });

  it('exposes the copy as a pure function', () => {
    expect(aiErrorCopy({ code: 'AI_KEY_REQUIRED', message: '' }).action).toEqual({
      label: 'Add API key',
      to: AI_KEYS_PATH,
    });
  });
});
