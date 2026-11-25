/**
 * Example (issue #732): a feature page opens the share dialog for one of its
 * records. Extension point: `ShareDialog` of `@marinoscar/platform-web/sharing/ui`
 * with `roles`, `allowGroups`, `allowLinks`, `linkRoles`, `linkExpiryPresets`
 * and `slots.Title`.
 *
 * The record is a kvox-style note (resource type `example_note` on the API:
 * viewer/editor grants, owner-only sharing, links that only view). The roles
 * passed here are the type's `roles` with the app's labels, weakest first;
 * the API remains the judge (it answers `422 ROLE_NOT_GRANTABLE` for a role
 * the type does not grant to that kind of grantee).
 *
 * The dialog runs on the app's platform host (`AppPlatformHostProvider`): the
 * app's transport and the viewer's permissions (`sharing:write` shows the
 * share form). Proven by ./ShareDialog.example.test.tsx.
 */

import { useState } from 'react';
import Button from '@mui/material/Button';
import { ShareDialog } from '@marinoscar/platform-web/sharing/ui';

const NOTE_ROLES = [
  { value: 'viewer', label: 'Can view' },
  { value: 'editor', label: 'Can edit' },
] as const;

/** A link only views: the type's `grantable.link` is `['viewer']`. */
const NOTE_LINK_ROLES = [{ value: 'viewer', label: 'Anyone with the link can view' }] as const;

/** The app's title slot: its own wording, inside the dialog's `DialogTitle`. */
function NoteShareTitle({ resourceTitle }: { resourceTitle?: string }) {
  return <>Share the note {resourceTitle ? `“${resourceTitle}”` : ''}</>;
}

export function NoteShareButton({ noteId, title, onShared }: { noteId: string; title: string; onShared?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Share</Button>
      <ShareDialog
        open={open}
        onClose={() => setOpen(false)}
        resource={{ type: 'example_note', id: noteId }}
        resourceTitle={title}
        roles={NOTE_ROLES}
        allowGroups
        allowLinks
        linkRoles={NOTE_LINK_ROLES}
        linkExpiryPresets={[
          { label: '7 days', days: 7 },
          { label: '30 days', days: 30 },
        ]}
        slots={{ Title: NoteShareTitle }}
        {...(onShared ? { onChanged: onShared } : {})}
      />
    </>
  );
}
