/**
 * The extension points of the packaged settings controls (PP-14.21):
 * `ExtraFields` on the profile and theme cards, the themes an app registered,
 * and the org settings field renderers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { TextField } from '@mui/material';
import type { OrgSettingsResponse } from '@marinoscar/platform-contract/settings';

import { render, mockUser } from './test-utils.js';
import { OrgSettingsPage } from '../../../src/settings/ui/OrgSettingsPage.js';
import { ProfileSettings } from '../../../src/settings/ui/ProfileSettings.js';
import type { ProfileExtraFieldsProps } from '../../../src/settings/ui/ProfileSettings.js';
import { ThemeSettings } from '../../../src/settings/ui/ThemeSettings.js';
import {
  orgSettingsFieldRenderer,
  registerOrgSettingsFieldRenderer,
  themePreferenceOptions,
  useThemePreferenceOptions,
} from '../../../src/settings/headless/index.js';
import type { OrgSettingsFieldRendererProps } from '../../../src/settings/headless/index.js';
import { createTestPlatformHost } from '../../../src/testing/index.js';

vi.mock('../../../src/settings/headless/profile-image.js', () => ({
  useProfileImageClient: () => ({ upload: vi.fn(), remove: vi.fn(), preview: vi.fn() }),
}));

function Pronouns({ values, onChange, disabled }: ProfileExtraFieldsProps) {
  return (
    <TextField
      label="Pronouns"
      value={(values.pronouns as string | undefined) ?? ''}
      disabled={disabled}
      onChange={(event) => onChange('pronouns', event.target.value)}
    />
  );
}

const noUser = { wrapperOptions: { user: { ...mockUser, providerProfileImageUrl: null } } };

describe('ThemeSettings with registered themes', () => {
  it('offers the registered themes after the built-in three and reports the chosen id', async () => {
    const onThemeChange = vi.fn();
    render(
      <ThemeSettings currentTheme="system" onThemeChange={onThemeChange} extraOptions={[{ id: 'high-contrast', label: 'High contrast' }]} />,
    );
    const buttons = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(buttons).toEqual(['light mode', 'dark mode', 'system preference', 'High contrast theme']);
    await userEvent.click(screen.getByRole('button', { name: 'High contrast theme' }));
    expect(onThemeChange).toHaveBeenCalledWith('high-contrast');
  });

  it('marks a registered theme as the stored one', () => {
    render(
      <ThemeSettings currentTheme="high-contrast" onThemeChange={vi.fn()} extraOptions={[{ id: 'high-contrast', label: 'High contrast' }]} />,
    );
    expect(screen.getByRole('button', { name: 'High contrast theme' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'light mode' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders the ExtraFields slot under the toggle with the card state', async () => {
    const onThemeChange = vi.fn();
    render(
      <ThemeSettings
        currentTheme="dark"
        onThemeChange={onThemeChange}
        disabled
        slots={{
          ExtraFields: ({ currentTheme, disabled }) => <p>extra {currentTheme} {String(disabled)}</p>,
        }}
      />,
    );
    expect(screen.getByText('extra dark true')).toBeInTheDocument();
  });

  it('derives the options from a settings document', () => {
    expect(themePreferenceOptions(null)).toEqual([]);
    expect(themePreferenceOptions({})).toBe(themePreferenceOptions({ themeOptions: [] }));
    const options = [{ id: 'sepia', label: 'Sepia' }];
    expect(themePreferenceOptions({ themeOptions: options })).toBe(options);
    const { result, rerender } = renderHook(({ doc }) => useThemePreferenceOptions(doc), { initialProps: { doc: { themeOptions: options } as { themeOptions?: typeof options } } });
    const first = result.current;
    rerender({ doc: { themeOptions: options } });
    expect(result.current).toBe(first);
  });
});

describe('ProfileSettings ExtraFields', () => {
  const profile = { displayName: 'Ada', imageSource: 'none' as const, imageObjectId: null, pronouns: 'she/her' };

  it('draws the app field with its stored value and saves only what changed, with the core patch', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProfileSettings profile={profile} onSave={onSave} slots={{ ExtraFields: Pronouns }} />, noUser);
    const field = screen.getByLabelText('Pronouns');
    expect(field).toHaveValue('she/her');
    const save = screen.getByRole('button', { name: 'Save Changes' });
    expect(save).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, 'they/them');
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ displayName: 'Ada', pronouns: 'they/them' });
  });

  it('sends null for a cleared field and nothing for an untouched or unchanged one', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProfileSettings profile={profile} onSave={onSave} slots={{ ExtraFields: Pronouns }} />, noUser);
    const field = screen.getByLabelText('Pronouns');
    // Typing the stored value back leaves nothing to save.
    await userEvent.clear(field);
    await userEvent.type(field, 'she/her');
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith({ displayName: 'Ada', pronouns: null });
  });

  it('adopts the saved document and drops the edit marks', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<ProfileSettings profile={profile} onSave={onSave} slots={{ ExtraFields: Pronouns }} />, noUser);
    await userEvent.clear(screen.getByLabelText('Pronouns'));
    await userEvent.type(screen.getByLabelText('Pronouns'), 'they/them');
    rerender(<ProfileSettings profile={{ ...profile, pronouns: 'they/them' }} onSave={onSave} slots={{ ExtraFields: Pronouns }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled());
    expect(screen.getByLabelText('Pronouns')).toHaveValue('they/them');
  });

  it('renders no extra control without the slot, even when the stored profile has one', () => {
    render(<ProfileSettings profile={profile} onSave={vi.fn()} />, noUser);
    expect(screen.queryByLabelText('Pronouns')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });
});

describe('registerOrgSettingsFieldRenderer', () => {
  const PAYLOAD: OrgSettingsResponse = {
    orgId: '11111111-1111-4111-8111-111111111111',
    value: { telemetry: { query: { slowQuerySeconds: 4 } } },
    effective: { telemetry: { query: { maxRows: 100, slowQuerySeconds: 4 } } },
    version: 1,
    updatedAt: null,
    namespaces: [
      {
        key: 'telemetry',
        description: 'Telemetry.',
        merge: 'tighten',
        writable: true,
        fields: [
          { name: 'query', kind: 'other' },
          { name: 'sampling', kind: 'other' },
        ],
      },
    ],
  };
  const permissions = ['org_settings:read', 'org_settings:write'];

  function renderPage() {
    const host = createTestPlatformHost({
      permissions,
      userId: mockUser.id,
      responses: { 'GET /org-settings': PAYLOAD, 'PATCH /org-settings': { ...PAYLOAD, version: 2 } },
    });
    const view = render(<OrgSettingsPage />, {
      wrapperOptions: { route: '/admin/settings/organization-settings', user: { ...mockUser, permissions }, host },
    });
    return { host, ...view };
  }

  beforeEach(() => {
    expect(orgSettingsFieldRenderer('telemetry', 'query')).toBeUndefined();
  });

  it('draws a registered renderer for that one field and keeps the note for the others', async () => {
    const seen: OrgSettingsFieldRendererProps[] = [];
    const unregister = registerOrgSettingsFieldRenderer('telemetry', 'query', (props) => {
      seen.push(props);
      return (
        <button type="button" disabled={props.disabled} onClick={() => props.onChange({ slowQuerySeconds: 2 })}>
          Slow query {String((props.value as { slowQuerySeconds?: number } | undefined)?.slowQuerySeconds)}
        </button>
      );
    });
    try {
      const { host } = renderPage();
      expect(await screen.findByRole('button', { name: 'Slow query 4' })).toBeEnabled();
      expect(screen.getByText(/sampling: managed by the slice's own settings page/)).toBeInTheDocument();
      expect(screen.queryByText(/query: managed by/)).not.toBeInTheDocument();
      expect(seen[0]).toMatchObject({ namespace: 'telemetry', field: { name: 'query', kind: 'other' }, inherited: { maxRows: 100, slowQuerySeconds: 4 } });

      await userEvent.click(screen.getByRole('button', { name: 'Slow query 4' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(host.requests.some((request) => request.method === 'PATCH')).toBe(true));
      expect(host.requests.find((request) => request.method === 'PATCH')).toMatchObject({
        body: { telemetry: { query: { slowQuerySeconds: 2 } } },
        ifMatch: '1',
      });
    } finally {
      unregister();
    }
    expect(orgSettingsFieldRenderer('telemetry', 'query')).toBeUndefined();
  });

  it('shows the note again once the renderer is unregistered', async () => {
    registerOrgSettingsFieldRenderer('telemetry', 'query', () => <span>drawn</span>)();
    renderPage();
    expect(await screen.findByText(/query: managed by the slice's own settings page/)).toBeInTheDocument();
  });

  it('replaces a renderer registered twice and only the latest unregister removes it', () => {
    const first = () => <span>one</span>;
    const second = () => <span>two</span>;
    const undoFirst = registerOrgSettingsFieldRenderer('ns', 'f', first);
    const undoSecond = registerOrgSettingsFieldRenderer('ns', 'f', second);
    expect(orgSettingsFieldRenderer('ns', 'f')).toBe(second);
    undoFirst();
    expect(orgSettingsFieldRenderer('ns', 'f')).toBe(second);
    undoSecond();
    expect(orgSettingsFieldRenderer('ns', 'f')).toBeUndefined();
  });
});
