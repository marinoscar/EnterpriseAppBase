import StickyNote2OutlinedIcon from '@mui/icons-material/StickyNote2Outlined';
import { identityUserSettingsSections } from '@marinoscar/platform-web/identity/ui';
import type { SettingsSectionDef } from '@marinoscar/platform-web/settings/ui';

/**
 * The per-user settings hub (`/settings`). The sample card is the app's own:
 * `notes:read` is the permission `GET /api/notes` enforces
 * (apps/api/src/notes/notes.controller.ts). APPEND new cards.
 */
export const USER_SETTINGS_SECTIONS: SettingsSectionDef[] = [
  { label: 'Security', cards: [...identityUserSettingsSections.security] },
  {
    label: 'Notes',
    cards: [
      {
        title: 'My notes',
        description: 'Write, archive and delete your own notes.',
        Icon: StickyNote2OutlinedIcon,
        path: '/notes',
        permission: 'notes:read',
      },
    ],
  },
];
