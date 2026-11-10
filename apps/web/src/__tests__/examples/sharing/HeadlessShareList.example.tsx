/**
 * Example (issue #732): the headless sharing hooks under the app's OWN markup.
 * Extension points: `useGrants`, `useShareActions` and `useSharedWithMe` of
 * `@marinoscar/platform-web/sharing/headless`.
 *
 * When `ShareDialog` does not fit (a compact sidebar, a design system of the
 * app's own), the hooks give the behaviour without any of the slice's UI:
 * every read hook returns `{ data, loading, error, refresh }`, every action
 * rejects with a `SharingError` whose `message` is safe to show. The hooks
 * use the app's platform host by default. Proven by
 * ./HeadlessShareList.example.test.tsx.
 */

import { useState } from 'react';
import { useGrants, useShareActions, useSharedWithMe, type ResourceRef } from '@marinoscar/platform-web/sharing/headless';

/** Who a record is shared with, as a plain list with "remove" buttons. */
export function CompactShareList({ resource }: { resource: ResourceRef }) {
  const grants = useGrants(resource);
  const actions = useShareActions(resource);
  const [problem, setProblem] = useState<string | null>(null);

  const remove = async (grantId: string) => {
    setProblem(null);
    try {
      await actions.revoke(grantId);
      await grants.refresh();
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  if (grants.loading && !grants.data) return <p>Loading…</p>;
  if (grants.error) return <p role="alert">{grants.error.message}</p>;
  return (
    <section aria-label="Access">
      <ul>
        {(grants.data?.items ?? []).map((grant) => (
          <li key={grant.id}>
            <span>{grant.grantee.kind === 'group' ? grant.grantee.groupName : (grant.grantee.displayName ?? grant.grantee.email)}</span>{' '}
            <em>{grant.role}</em>{' '}
            <button type="button" disabled={actions.pending} onClick={() => void remove(grant.id)}>
              Remove {grant.grantee.displayName ?? grant.grantee.groupName}
            </button>
          </li>
        ))}
      </ul>
      {problem ? <p role="alert">{problem}</p> : null}
    </section>
  );
}

/** "Shared with me" notes, linked to their pages. */
export function SharedNotes() {
  const shared = useSharedWithMe('example_note');
  return (
    <nav aria-label="Shared with me">
      {(shared.data?.items ?? []).map((item) => (
        <a key={item.grantId} href={item.path ?? '#'}>
          {item.title ?? 'Untitled'} ({item.role})
        </a>
      ))}
    </nav>
  );
}
