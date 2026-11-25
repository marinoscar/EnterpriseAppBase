/**
 * Reference example (PP-14.25): an app adds an unread badge to a navigation
 * destination, groups destinations and links to a help site from the same table
 * the rail, the bottom bar and the user menu draw.
 *
 * `badge` is a function the shell calls while it renders the destination on
 * each surface, so it may be a hook: here `useUnreadCount` reads a tiny store
 * (a fork would read its notifications endpoint or an SSE stream). It returns a
 * number for a count, which also becomes part of the accessible name ("Inbox (3)").
 *
 * Wire it where the app declares its navigation (`config/destinations.ts`):
 * add `INBOX_DESTINATION` and `HELP_DESTINATION` to `DESTINATIONS`. The
 * reference app does not: it ships compiled and tested, like the other web
 * examples, and its bottom bar keeps its four destinations.
 */
import HelpOutlinedIcon from '@mui/icons-material/HelpOutlined';
import InboxIcon from '@mui/icons-material/Inbox';
import { useSyncExternalStore } from 'react';
import type { ShellDestination } from '@marinoscar/platform-web/shell/headless';

type Listener = () => void;

/** A minimal external store for the unread count. */
export const unreadStore = (() => {
  let count = 0;
  const listeners = new Set<Listener>();
  return {
    get: () => count,
    set(next: number) {
      count = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();

/** The unread count. A hook, so the shell must call `badge` from a component (it does). */
export function useUnreadCount(): number {
  return useSyncExternalStore(unreadStore.subscribe, unreadStore.get, unreadStore.get);
}

/** An Inbox destination with an unread count, under a "Work" heading in the rail. */
export const INBOX_DESTINATION: ShellDestination = {
  key: 'inbox',
  label: 'Inbox',
  compactLabel: 'Inbox',
  Icon: InboxIcon,
  path: '/inbox',
  group: 'Work',
  badge: useUnreadCount,
};

/** A link to the help centre on another site: opens in a new tab, never the active destination. */
export const HELP_DESTINATION: ShellDestination = {
  key: 'help',
  label: 'Help centre',
  compactLabel: 'Help',
  Icon: HelpOutlinedIcon,
  path: 'https://help.example.com/',
  external: true,
};
