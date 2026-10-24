// What is shared with the viewer, grouped by resource type (issue #731).

import { Alert, Box, Button, CircularProgress, List, ListItem, ListItemButton, ListItemText, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import type { SharedWithMeItem } from '@marinoscar/platform-contract/sharing';
import type { ComponentType, ReactElement } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import type { SharingClient } from '../headless/client.js';
import { useSharedWithMe } from '../headless/useSharedWithMe.js';
import { expiryText, humanizeType } from '../internal/format.js';

/**
 * The parts of {@link SharedWithMeList} an app may replace.
 *
 * @stability experimental
 */
export interface SharedWithMeListSlots {
  /** One item. Default a list row linking to its path, with the role and the expiry. */
  Item?: ComponentType<{
    /** The shared record, as the API returned it. */
    item: SharedWithMeItem;
    /** Where it opens (`resolvePath`, else the API's `path`), or `null`. */
    path: string | null;
    /** Its title, or a fallback built from its type and id. */
    title: string;
  }>;
}

/**
 * The props of {@link SharedWithMeList}.
 *
 * @stability experimental
 */
export interface SharedWithMeListProps {
  /** Only records of this type; omit for every type. */
  resourceType?: string;
  /**
   * Where an item opens. Default the `path` the API returned (the resource
   * type's `describe`), else no link.
   */
  resolvePath?: (resourceType: string, resourceId: string, item: SharedWithMeItem) => string | null;
  /** A heading per resource type, e.g. `{ transcript: 'Transcripts' }`. Default the humanised type id. */
  typeLabels?: Readonly<Record<string, string>>;
  /** A label per role, e.g. `{ viewer: 'Can view' }`. Default the role id. */
  roleLabels?: Readonly<Record<string, string>>;
  /** The text while nothing is shared. */
  emptyText?: string;
  /** The sharing client; default one over the host's transport. */
  client?: SharingClient;
  /** Parts to replace. */
  slots?: SharedWithMeListSlots;
  /** Styles for the root. */
  sx?: SxProps<Theme>;
  /** A class for the root. */
  className?: string;
}

/**
 * Records shared with the viewer (directly or through a group), grouped by
 * resource type, titled by the type's `describe` when the API returns it.
 *
 * @param props - see {@link SharedWithMeListProps}.
 * @returns the list.
 *
 * @example
 * ```tsx
 * <SharedWithMeList resolvePath={(type, id) => (type === 'transcript' ? `/transcripts/${id}` : null)} />
 * ```
 *
 * @stability experimental
 */
export function SharedWithMeList(props: SharedWithMeListProps): ReactElement {
  const shared = useSharedWithMe(props.resourceType, props.client ? { client: props.client } : {});
  const items = shared.data?.items ?? [];

  const byType = new Map<string, SharedWithMeItem[]>();
  for (const item of items) {
    const list = byType.get(item.resourceType) ?? [];
    list.push(item);
    byType.set(item.resourceType, list);
  }

  let body: ReactElement;
  if (shared.loading && shared.data === null) {
    body = <CircularProgress size={24} aria-label="Loading what is shared with you" />;
  } else if (shared.error) {
    body = (
      <Alert severity="error" action={<Button onClick={() => void shared.refresh()}>Retry</Button>}>
        {shared.error.message}
      </Alert>
    );
  } else if (items.length === 0) {
    body = (
      <Typography variant="body2" color="text.secondary">
        {props.emptyText ?? 'Nothing is shared with you yet.'}
      </Typography>
    );
  } else {
    body = (
      <>
        {[...byType.entries()].map(([type, typeItems]) => {
          const heading = props.typeLabels?.[type] ?? humanizeType(type);
          return (
            <Box key={type} component="section" sx={{ mb: 2 }}>
              <Typography variant="subtitle1" component="h3">
                {heading}
              </Typography>
              <List dense aria-label={heading}>
                {typeItems.map((item) => {
                  const path = props.resolvePath ? props.resolvePath(item.resourceType, item.resourceId, item) : item.path;
                  const title = item.title ?? `${humanizeType(type)} ${item.resourceId.slice(0, 8)}`;
                  if (props.slots?.Item) {
                    const Item = props.slots.Item;
                    return <Item key={item.grantId} item={item} path={path} title={title} />;
                  }
                  const role = props.roleLabels?.[item.role] ?? item.role;
                  const secondary = `${role}${item.via === 'group_grant' ? ' · through a group' : ''} · ${expiryText(item.expiresAt)}`;
                  return path ? (
                    <ListItemButton key={item.grantId} component={RouterLink} to={path}>
                      <ListItemText primary={title} secondary={secondary} />
                    </ListItemButton>
                  ) : (
                    <ListItem key={item.grantId}>
                      <ListItemText primary={title} secondary={secondary} />
                    </ListItem>
                  );
                })}
              </List>
            </Box>
          );
        })}
      </>
    );
  }

  return (
    <Box sx={props.sx} className={props.className} data-testid="shared-with-me">
      {body}
    </Box>
  );
}
