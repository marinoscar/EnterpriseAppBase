# apps/web rules

Root rules ([AGENTS.md](../../AGENTS.md)) apply. This file is what to get right when editing the React app. Spec: [docs/specs/settings-ui.md](../../docs/specs/settings-ui.md).

## Layout

- `src/config/`: `adminSections.tsx`, `userSettingsSections.tsx`, `destinations.ts`, `shell.ts`.
- `src/pages/` (`Admin/SettingsHubPage.tsx`, `UserSettingsHubPage.tsx`), `src/components/`, `src/hooks/`, `src/services/`, `src/platform/`, `src/identity/` (slots and providers for `@marinoscar/platform-web/identity`).
- Most features are packaged in `@marinoscar/platform-web/<slice>`; the app binds them. Fix a packaged page in `packages/platform-web/src/<slice>/`, not by copying it here.
- Tests: `src/__tests__/` (Vitest + RTL), `conformance.test.ts`, `config/settingsCards.test.ts`. Run `npm run test:run --workspace=web`, `npm run typecheck --workspace=web`.

## Settings UI Pattern (rules 1 to 5 in root AGENTS.md)

1. A new settings page is a card appended to `ADMIN_SECTIONS` or `USER_SETTINGS_SECTIONS`, plus its route in `App.tsx`. No route without a card.
2. Never add a settings page as a tab of another settings page. Tabs only for parallel content inside one destination.
3. A card's `permission` is the exact string the API controller enforces (a string, or a list where the viewer needs ANY ONE). Writes are gated inside the page by disabling controls.
4. Reuse `SettingsHub` from `@marinoscar/platform-web/settings/ui`; never fork it.
5. Card `feature`: `'ai'` for AI cards (not the admin `AI` card itself), `'telemetry'`, `'orgs'` for organization cards.

## Five coupled breakpoint gates

Change all five together or none. The boundary is `sm` (600px), never `md` (900px). No shared constant binds them.

| # | Gate | File (under `packages/platform-web/src/`) |
|---|---|---|
| 1 | `ShellLayout` `showRail` (`up('sm')`) | `shell/ui/ShellLayout.tsx` |
| 2 | `ShellBottomNav` self-gate `down('sm')` | `shell/ui/ShellBottomNav.tsx` |
| 3 | `<main>` `pb: { xs: 10, sm: 3 }` | `shell/ui/ShellLayout.tsx` |
| 4 | `SettingsHub` `isCompactWindow` (`down('sm')`) | `settings/ui/SettingsHub.tsx` |
| 5 | `ShellAppBar` `isCompactWindow` (`down('sm')`) | `shell/ui/ShellAppBar.tsx` |

The app's `Layout.tsx`, `AppBar.tsx`, `NavigationRail.tsx`, `BottomNav.tsx` only fill slots.

## Frontend conventions

- The UI presents; the API authorizes. Hiding a card or button is not security.
- The access token goes in `Authorization: Bearer`; the only cookie is the HttpOnly `refresh_token`.
- Never call an AI provider from the browser; go through `/api/ai/*`.
- Storage, AI, Web Push and SMTP settings are admin-UI runtime config, never build-time variables.
- Use MUI theming and the responsive shell; write components and hooks with tests.
