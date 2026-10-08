import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ADMIN_SECTIONS } from '../config/adminSections';
import { NAVIGATION } from '../config/navigation';
import { USER_SETTINGS_SECTIONS } from '../config/userSettingsSections';

// The Settings UI Pattern, as tests: every card is reachable (App.tsx has its
// route) and the app's own card declares the exact permission its API route
// enforces. The packaged cards are checked by the platform's own suites.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const appSource = read('../App.tsx');
const cards = [...ADMIN_SECTIONS, ...USER_SETTINGS_SECTIONS].flatMap((section) => section.cards);

describe('settings registries', () => {
  it('give every card a unique path', () => {
    const paths = cards.map((card) => card.path);
    expect(paths.every(Boolean)).toBe(true);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it.each(cards.map((card) => [card.path!]))('route %s exists in App.tsx', (path) => {
    expect(appSource).toContain(`path="${path.replace(/^\//, '')}"`);
  });

  it('gate the notes card with the permission GET /api/notes enforces', () => {
    const controller = read('../../../api/src/notes/notes.controller.ts');
    const listRoute = /@Get\(\)\s*\n\s*@Auth\(\{ permissions: \['([^']+)'\] \}\)/.exec(controller);
    const card = cards.find((c) => c.path === '/notes');
    expect(listRoute?.[1]).toBe('notes:read');
    expect(card?.permission).toBe(listRoute?.[1]);
  });
});

// The shell's navigation (the rail, the bottom bar, the user menu) reaches the
// same routes, behind the same permissions, as the cards.
describe('shell navigation', () => {
  it.each(NAVIGATION.destinations.filter((d) => d.path !== '/').map((d) => [d.path]))('destination %s has a route in App.tsx', (path) => {
    expect(appSource).toContain(`path="${path.replace(/^\//, '')}"`);
  });

  it('gate the Notes destination with its card\'s permission', () => {
    const destination = NAVIGATION.destinations.find((d) => d.key === 'notes');
    expect(destination?.permission).toBe(cards.find((c) => c.path === '/notes')?.permission);
  });

  it('fit the bottom bar (four destinations at most)', () => {
    expect(NAVIGATION.destinations.length).toBeLessThanOrEqual(4);
  });
});
