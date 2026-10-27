/**
 * The "Usage" section of `/settings/ai` (issue #444) against the MSW network:
 * what it asks `GET /api/ai/usage/me` for, and each fixture state.
 */
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { TestApiRequest } from '../../../src/testing/index.js';
import { ApiError, render } from '../harness.js';
import { MyAiUsageSection } from '../../../src/ai/ui/user/MyAiUsageSection.js';
import { mockAiUsageEmpty, mockAiUsageReport } from '../fixtures.js';

describe('MyAiUsageSection', () => {
  it('asks for the last 30 days by model and renders totals and a model table', async () => {
    const seen: URLSearchParams[] = [];
    render(<MyAiUsageSection />, {
      responses: {
        'GET /ai/usage/me': (request: TestApiRequest) => {
          seen.push(new URL(request.path, 'http://test.local').searchParams);
          return mockAiUsageReport('model');
        },
      },
    });

    expect(screen.getByLabelText('Loading your AI usage')).toBeInTheDocument();
    const tiles = await screen.findByRole('group', { name: 'Your AI usage totals' });
    expect(within(tiles).getByText('120')).toBeInTheDocument();
    expect(within(tiles).getByText('5.0%')).toBeInTheDocument();
    expect(screen.getByText(/30 of these requests used your organization/)).toBeInTheDocument();

    const table = screen.getByTestId('my-ai-usage-table');
    expect(within(table).getByText('gpt-5-mini')).toBeInTheDocument();
    expect(within(table).getByText('gpt-5')).toBeInTheDocument();

    expect(seen).toHaveLength(1);
    expect(seen[0].get('groupBy')).toBe('model');
    const span =
      (Date.parse(seen[0].get('to') ?? '') - Date.parse(seen[0].get('from') ?? '')) / 86_400_000 + 1;
    expect(span).toBe(30);
  });

  it('says so when there is no usage', async () => {
    render(<MyAiUsageSection />, { responses: { 'GET /ai/usage/me': mockAiUsageEmpty('model') } });

    expect(
      await screen.findByText("You haven't made any AI requests in the last 30 days."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('my-ai-usage-table')).not.toBeInTheDocument();
  });

  it('shows a refusal as an error inside the section only', async () => {
    render(<MyAiUsageSection />, {
      responses: {
        'GET /ai/usage/me': () => {
          throw new ApiError('AI is disabled', 403, 'FORBIDDEN');
        },
      },
    });

    const section = await screen.findByRole('region', { name: 'Usage' });
    expect(await within(section).findByRole('alert')).toHaveTextContent('AI is disabled');
  });
});
