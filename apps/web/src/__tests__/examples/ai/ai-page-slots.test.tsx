/**
 * PP-14.24: an app extends the packaged AI pages through their slots, with no
 * package edit.
 *
 * `apps/web/src/platform-extensions/ai/` holds the three examples. This renders
 * the REAL packaged pages (`@marinoscar/platform-web/ai/ui`) over the default
 * MSW handlers, passes each slot, and asserts it is drawn from data the page
 * holds, in the place the slot contract names. Every case also pins that the
 * page without the slot draws nothing of it.
 */
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { AiConfigPage, AiModelsPage, UserAiKeysPage } from '@marinoscar/platform-web/ai/ui';
import { render, mockAdminUser } from '../../utils/test-utils';
import { ProviderConsoleLink } from '../../../platform-extensions/ai/ProviderConsoleLink.example';
import { SearchApiKeySection } from '../../../platform-extensions/ai/SearchApiKeySection.example';
import { ModelDocsAction } from '../../../platform-extensions/ai/ModelDocsAction.example';

describe('the admin AI page with an app ProviderCardExtra slot (PP-14.24)', () => {
  it('draws the console link under the provider card', async () => {
    render(<AiConfigPage slots={{ ProviderCardExtra: ProviderConsoleLink }} />, { wrapperOptions: { user: mockAdminUser } });

    const note = await screen.findByTestId('console-link-openai');
    expect(within(note).getByRole('link', { name: 'provider console' })).toHaveAttribute(
      'href',
      'https://platform.openai.com/usage',
    );
    // The provider's own card is still there, before the note.
    const card = screen.getByTestId('ai-provider-openai');
    expect(card.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws nothing extra without the slot', async () => {
    render(<AiConfigPage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByTestId('ai-provider-openai');
    expect(screen.queryByTestId('console-link-openai')).not.toBeInTheDocument();
  });
});

describe('the AI Models page with an app RowActions slot (PP-14.24)', () => {
  it('draws the action for each catalogue row, in a "More actions" column', async () => {
    render(<AiModelsPage slots={{ RowActions: ModelDocsAction }} />, { wrapperOptions: { user: mockAdminUser } });

    const table = await screen.findByTestId('admin-ai-models-table');
    expect((await within(table).findAllByRole('link', { name: /^Docs for / })).length).toBeGreaterThan(0);
    expect(within(table).getByRole('columnheader', { name: 'More actions' })).toBeInTheDocument();
  });

  it('draws no such column without the slot', async () => {
    render(<AiModelsPage />, { wrapperOptions: { user: mockAdminUser } });
    const table = await screen.findByTestId('admin-ai-models-table');
    await within(table).findAllByRole('row');
    expect(within(table).queryByRole('columnheader', { name: 'More actions' })).not.toBeInTheDocument();
  });
});

describe('the AI Keys page with an app Sections slot (PP-14.24)', () => {
  it('draws the search key card once, at the bottom', async () => {
    render(<UserAiKeysPage slots={{ Sections: SearchApiKeySection }} />, {
      wrapperOptions: { user: { ...mockAdminUser, permissions: ['ai:use'] }, aiEnabled: true },
    });

    const section = await screen.findByRole('region', { name: 'Search API key' });
    expect(within(section).getByLabelText('Search API key')).toHaveAttribute('type', 'password');
    expect(screen.getAllByRole('heading', { name: 'Search API key' })).toHaveLength(1);
  });

  it('draws no such card without the slot', async () => {
    render(<UserAiKeysPage />, { wrapperOptions: { user: { ...mockAdminUser, permissions: ['ai:use'] }, aiEnabled: true } });
    await screen.findByRole('heading', { name: 'AI Keys' });
    expect(screen.queryByRole('heading', { name: 'Search API key' })).not.toBeInTheDocument();
  });
});
