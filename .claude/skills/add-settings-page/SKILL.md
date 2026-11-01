---
name: add-settings-page
description: Add an admin or per-user settings page to the web app as a registry card - the entry in adminSections.tsx or userSettingsSections.tsx, the exact permission string the API controller enforces, reuse of SettingsHub, the route, feature gates, and the registry tests. Use when adding any new settings screen, admin Console page or per-user preference page.
---

# Add a settings page

Rationale and accessibility: `docs/specs/settings-ui.md` (`grep -n '^#' <file>`, read the section you need). Run web checks from `apps/web`.

## Steps

1. Write the page component. Gate writes inside the page (disabled controls), not with a second card permission. Hide controls with `usePermissions`; the API enforces.
2. Add ONE card to the registry, appended after existing cards (never inserted between):
   - admin: `ADMIN_SECTIONS` in `apps/web/src/config/adminSections.tsx`
   - per-user: `USER_SETTINGS_SECTIONS` in `apps/web/src/config/userSettingsSections.tsx`
   A card is `{ title, description, Icon, path, permission?, feature?, alwaysShow? }` (`SettingsCardDef`, `packages/platform-web/src/settings/ui/registry.ts`). `Icon` is a component, never a rendered element.
3. Add the route in `apps/web/src/App.tsx` beside the other `/admin/settings/*` (or `/settings/*`) routes. A route without a registry entry is unacceptable: the hub, the Console rail and the AppBar title resolver would not know it.
4. Add API calls through `apps/web/src/services/api.ts` wrapped in a hook.

## Rules

- A new page is a card, never a tab on an existing settings page. Tabs are only for parallel content inside one destination (`packages/platform-web/src/identity/ui/users/UsersPage.tsx`: Users, Allowlist).
- `permission` is the exact string the controller's `@Auth(...)` enforces; read it off the controller. Known: `system_settings:read`/`write` (`system-settings.controller.ts`), `users:read`, `org_members:read`, `organizations:read`, `org_settings:read`. An array means any one of them. Never invent one.
- Reuse `SettingsHub` from `@marinoscar/platform-web/settings/ui` (`packages/platform-web/src/settings/ui/SettingsHub.tsx`). A new hub is a binding (`sections`, `hubKey`, `title`, `subtitle`, `features`); never fork it. `/settings` is `apps/web/src/pages/UserSettingsHubPage.tsx`.
- `feature: 'ai'` for every AI card (hidden while AI is off). The one exception is the admin `AI` card, where AI is switched on. Org cards use `feature: 'orgs'`.
- Never call a provider from the browser; AI goes through `/api/ai/*`.
- The five breakpoint gates (`ShellLayout` `showRail` and `<main>` `pb`, `ShellBottomNav`, `ShellAppBar` and `SettingsHub` `isCompactWindow`, all at `sm` 600px) move together or not at all. Do not touch them for a normal page.
- Runtime-configured features (storage, AI, Web Push, SMTP) never get environment variables.

## Verify

```bash
cd apps/web && npm run typecheck && npm run test:run
```

The registry suites must pass: `apps/web/src/__tests__/conformance.test.ts` (`settings-*`, incl. `settings-ai-cards`) and `apps/web/src/__tests__/config/` (`settingsCards.test.ts`, `userSettingsSections.test.ts`). Add component and hook tests with MSW. Check phone width and desktop width. Flag the card for the docs agent (settings-page inventory in `docs/ARCHITECTURE.md`).
