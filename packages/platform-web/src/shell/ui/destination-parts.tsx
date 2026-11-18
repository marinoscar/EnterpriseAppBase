// The parts every shell surface shares when it draws a destination (PP-14.25):
// the badge on the icon, the accessible name that carries the badge, the
// external-link attributes and the click hook. Slice-internal.

import { Badge } from '@mui/material';
import type { MouseEvent, ReactElement, ReactNode } from 'react';

import type { ShellDestination, ShellIcon } from '../headless/navigation.js';

/** A destination's badge, normalised. */
export interface DestinationBadge {
  /** What the badge shows. */
  content: ReactNode;
  /** The badge as text for the accessible name (a count or a string), or `null` for a custom mark. */
  text: string | null;
}

/**
 * Evaluate a destination's `badge`. Call it from a component that exists once
 * per destination (the rail row, the bar's item, the menu row): `badge` may call
 * hooks, and that component's hook order is then stable.
 *
 * @param destination - the destination (or its `badge`).
 * @returns the badge, or `null` for none.
 */
export function useDestinationBadge(destination: Pick<ShellDestination, 'badge'>): DestinationBadge | null {
  const value = destination.badge?.();
  if (value === null || value === undefined || value === false || value === true || value === 0 || value === '') return null;
  if (typeof value === 'number' || typeof value === 'string') return { content: value, text: String(value) };
  return { content: value, text: null };
}

/**
 * The accessible name of a destination: its label, then the badge as a count
 * ("Inbox (3)") and, for an external one, that it opens elsewhere.
 *
 * @param label - the destination's full label.
 * @param badge - its evaluated badge.
 * @param external - whether it opens another site in a new tab.
 * @returns the name.
 */
export function destinationAccessibleName(label: string, badge: DestinationBadge | null, external: boolean | undefined): string {
  return `${label}${badge?.text ? ` (${badge.text})` : ''}${external ? ' (opens in a new tab)' : ''}`;
}

/** The icon of a destination, with its badge when it has one. With none it IS the icon. */
export function DestinationIcon({
  Icon,
  badge,
  fontSize,
}: {
  Icon: ShellIcon;
  badge: DestinationBadge | null;
  fontSize?: 'inherit' | 'large' | 'medium' | 'small';
}): ReactElement {
  const icon = fontSize ? <Icon fontSize={fontSize} /> : <Icon />;
  if (!badge) return icon;
  return (
    <Badge badgeContent={badge.content} color="error" max={99} data-testid="destination-badge">
      {icon}
    </Badge>
  );
}

/** The anchor attributes of an external destination. */
export const EXTERNAL_LINK_PROPS = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * Run a destination's `onClick`.
 *
 * @param destination - the destination.
 * @param event - the click.
 * @returns whether the handler cancelled the navigation (`event.preventDefault()`).
 */
export function runDestinationClick(destination: Pick<ShellDestination, 'onClick'>, event: MouseEvent<HTMLElement>): boolean {
  destination.onClick?.(event);
  return event.defaultPrevented;
}
