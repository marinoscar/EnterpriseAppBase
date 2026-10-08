// =============================================================================
// ShareDialog: share one record with people, groups and (optionally) a link
// (issue #731, PP-7.4)
// =============================================================================
//
// Two STACKED sections, never tabs: links are off for many resource types, and
// a tab strip whose second tab comes and goes is confusing (the story's
// rejected alternative).
//
//   1. People and groups: an e-mail field (validated) or a group picker
//      (`useGroups('mine')`), a role select with a visible label, and the list
//      of active grants with a role change and a remove per row.
//   2. Link, only with `allowLinks`: create a link with an expiry preset, then
//      copy, read the expiry of, or revoke each active link. The share URL is
//      shown as read-only text too, the copy button's fallback.
//
// Errors show the API's own message (kvox's `shareErrorMessage` approach); a
// 429 shows its wait in plain language. Async results are announced through an
// `aria-live` region. MUI's Dialog traps focus and returns it on close.
// =============================================================================

import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import type { GrantDto, LinkGrantView } from '@marinoscar/platform-contract/sharing';
import { useId, useState } from 'react';
import type { ComponentType, FormEvent, ReactElement } from 'react';

import type { SharingClient } from '../headless/client.js';
import { toSharingError } from '../headless/errors.js';
import type { ResourceRef, SharingError, SharingRoleOption } from '../headless/types.js';
import { useGrants, useShareActions } from '../headless/useGrants.js';
import { useGroups } from '../headless/useGroups.js';
import { useLinkGrants } from '../headless/useLinkGrants.js';
import { EMAIL_PATTERN, expiryFromDays, expiryText } from '../internal/format.js';
import { LiveRegion } from '../internal/live-region.js';
import { useCan } from '../internal/use-can.js';
import { DEFAULT_LINK_EXPIRY_PRESETS } from './copy.js';

/**
 * The parts of {@link ShareDialog} an app may replace.
 *
 * @stability experimental
 */
export interface ShareDialogSlots {
  /** The dialog title. Default "Share" / "Share <resourceTitle>". Rendered inside `DialogTitle`. */
  Title?: ComponentType<{
    /** The record's name, when the dialog was given one. */
    resourceTitle?: string;
  }>;
}

/**
 * The props of {@link ShareDialog}.
 *
 * @stability experimental
 */
export interface ShareDialogProps {
  /** Whether the dialog is open. Nothing is fetched while it is closed. */
  open: boolean;
  /** Called on "Done", Escape or a backdrop click. */
  onClose: () => void;
  /** The record to share. */
  resource: ResourceRef;
  /** The record's name, for the title. */
  resourceTitle?: string;
  /** The roles a person or group may be given, weakest first; the first is the default. */
  roles: readonly SharingRoleOption[];
  /** Offer sharing with a group. Default `true`. */
  allowGroups?: boolean;
  /** Show the link section (the type lists link roles on the API). Default `false`. */
  allowLinks?: boolean;
  /** The roles a link may grant. Default the first of `roles` only. */
  linkRoles?: readonly SharingRoleOption[];
  /** The link lifetimes offered, first is the default. Default 1, 7, 30 days and never. */
  linkExpiryPresets?: ReadonlyArray<{
    /** What the select shows ("7 days"). */
    label: string;
    /** The lifetime in days, or `null` for a link that never expires. */
    days: number | null;
  }>;
  /** Called after every successful change (a share, a role change, a revoke, a link). */
  onChanged?: () => void;
  /** Permission check for hiding controls; default the host viewer's. Writes need `sharing:write`. */
  can?: (permission: string) => boolean;
  /** The sharing client; default one over the host's transport. */
  client?: SharingClient;
  /** Parts to replace. */
  slots?: ShareDialogSlots;
  /** Styles for the dialog paper. */
  sx?: SxProps<Theme>;
  /** A class for the dialog root. */
  className?: string;
}

function DefaultTitle({ resourceTitle }: { resourceTitle?: string }): ReactElement {
  return <>{resourceTitle ? `Share "${resourceTitle}"` : 'Share'}</>;
}

function granteeName(grant: GrantDto): { primary: string; secondary: string } {
  const g = grant.grantee;
  if (g.kind === 'group') return { primary: g.groupName ?? 'Group', secondary: 'Group' };
  if (g.displayName && g.email) return { primary: g.displayName, secondary: g.email };
  return { primary: g.email ?? g.displayName ?? 'Someone', secondary: 'Person' };
}

function roleLabel(roles: readonly SharingRoleOption[], value: string): string {
  return roles.find((role) => role.value === value)?.label ?? value;
}

/** A link list that failed because the route or the feature is not there: show "not available", not an error. */
function linksUnavailable(error: SharingError | null): boolean {
  return error !== null && (error.status === 404 || error.status === 405 || error.status === 501);
}

/**
 * The share dialog: people and groups, then (with `allowLinks`) link shares,
 * as stacked sections. Built on `useGrants`, `useShareActions`, `useGroups`
 * and `useLinkGrants`.
 *
 * @param props - see {@link ShareDialogProps}.
 * @returns the dialog.
 *
 * @example
 * ```tsx
 * <ShareDialog
 *   open={open}
 *   onClose={() => setOpen(false)}
 *   resource={{ type: 'transcript', id }}
 *   resourceTitle={title}
 *   roles={[{ value: 'viewer', label: 'Can view' }, { value: 'editor', label: 'Can edit' }]}
 * />
 * ```
 *
 * @stability experimental
 */
export function ShareDialog(props: ShareDialogProps): ReactElement {
  const { open, onClose, resource, resourceTitle, roles, onChanged, slots, sx, className } = props;
  const allowGroups = props.allowGroups ?? true;
  const allowLinks = props.allowLinks ?? false;
  const linkRoles = props.linkRoles ?? roles.slice(0, 1);
  const presets = props.linkExpiryPresets ?? DEFAULT_LINK_EXPIRY_PRESETS;
  const can = useCan(props.can);
  const canWrite = can('sharing:write');
  const Title = slots?.Title ?? DefaultTitle;
  const ids = useId();

  const clientOption = props.client ? { client: props.client } : {};
  const grants = useGrants(resource, { enabled: open, ...clientOption });
  const share = useShareActions(resource, clientOption);
  const groups = useGroups({ scope: 'mine', enabled: open && allowGroups, ...clientOption });
  const links = useLinkGrants(resource, { enabled: open && allowLinks, ...clientOption });

  const [mode, setMode] = useState<'person' | 'group'>('person');
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [role, setRole] = useState(roles[0]?.value ?? '');
  const [shareError, setShareError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkRole, setLinkRole] = useState(linkRoles[0]?.value ?? '');
  const [linkPreset, setLinkPreset] = useState(0);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const emailValid = EMAIL_PATTERN.test(email.trim());
  const changed = (message: string) => {
    setAnnouncement(message);
    onChanged?.();
  };

  const submitShare = async (event: FormEvent) => {
    event.preventDefault();
    setShareError(null);
    try {
      if (mode === 'person') {
        setEmailTouched(true);
        if (!emailValid) return;
        const address = email.trim().toLowerCase();
        await share.shareWithEmail(address, role);
        setEmail('');
        setEmailTouched(false);
        changed(`Shared with ${address}.`);
      } else {
        if (!groupId) return;
        await share.shareWithGroup(groupId, role);
        const name = groups.data?.items.find((group) => group.id === groupId)?.name ?? 'the group';
        setGroupId('');
        changed(`Shared with ${name}.`);
      }
      await grants.refresh();
    } catch (err) {
      setShareError(toSharingError(err).message);
    }
  };

  const changeRole = async (grant: GrantDto, next: string) => {
    setShareError(null);
    try {
      await share.changeRole(grant.id, next);
      changed(`${granteeName(grant).primary} now has the role ${roleLabel(roles, next)}.`);
      await grants.refresh();
    } catch (err) {
      setShareError(toSharingError(err).message);
    }
  };

  const revoke = async (grant: GrantDto) => {
    setShareError(null);
    try {
      await share.revoke(grant.id);
      changed(`Access removed for ${granteeName(grant).primary}.`);
      await grants.refresh();
    } catch (err) {
      setShareError(toSharingError(err).message);
    }
  };

  const createLink = async () => {
    setLinkError(null);
    try {
      const preset = presets[linkPreset];
      const issued = await links.create({
        ...(linkRole ? { role: linkRole } : {}),
        expiresAt: expiryFromDays(preset?.days ?? null),
      });
      changed('Link created.');
      await links.refresh();
      if (issued.url) {
        const copied = await links.copyUrl(issued.url);
        if (copied) setAnnouncement('Link created and copied to the clipboard.');
      }
    } catch (err) {
      setLinkError(toSharingError(err).message);
    }
  };

  const copyLink = async (link: LinkGrantView) => {
    if (!link.url) return;
    const copied = await links.copyUrl(link.url);
    if (copied) {
      setCopyFallback(null);
      setAnnouncement('Link copied to the clipboard.');
    } else {
      setCopyFallback(link.id);
      setAnnouncement('Could not copy automatically. Select the link and copy it.');
    }
  };

  const revokeLink = async (link: LinkGrantView) => {
    setLinkError(null);
    try {
      await links.revoke(link.id);
      changed('Link revoked. It no longer works.');
      await links.refresh();
    } catch (err) {
      setLinkError(toSharingError(err).message);
    }
  };

  const grantItems = grants.data?.items ?? [];
  const groupItems = groups.data?.items ?? [];
  const linkItems = links.data ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      className={className}
      aria-labelledby={`${ids}-title`}
      slotProps={{ paper: { sx } }}
    >
      <DialogTitle id={`${ids}-title`}>
        <Title {...(resourceTitle === undefined ? {} : { resourceTitle })} />
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          {/* ---- Section 1: people and groups ---- */}
          <Box component="section" aria-labelledby={`${ids}-people`}>
            <Typography id={`${ids}-people`} variant="subtitle1" component="h3" gutterBottom>
              {allowGroups ? 'People and groups' : 'People'}
            </Typography>

            {canWrite && (
              <Box component="form" onSubmit={submitShare} noValidate>
                <Stack spacing={2}>
                  {allowGroups && (
                    <ToggleButtonGroup
                      value={mode}
                      exclusive
                      size="small"
                      onChange={(_event, value: 'person' | 'group' | null) => value && setMode(value)}
                      aria-label="Share with"
                    >
                      <ToggleButton value="person">A person</ToggleButton>
                      <ToggleButton value="group">A group</ToggleButton>
                    </ToggleButtonGroup>
                  )}
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
                    {mode === 'person' ? (
                      <TextField
                        label="E-mail address"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        onBlur={() => setEmailTouched(email.length > 0)}
                        error={emailTouched && !emailValid}
                        helperText={emailTouched && !emailValid ? 'Enter a valid e-mail address.' : ' '}
                        autoComplete="email"
                        size="small"
                        fullWidth
                      />
                    ) : (
                      <TextField
                        select
                        label="Group"
                        value={groupId}
                        onChange={(event) => setGroupId(event.target.value)}
                        size="small"
                        fullWidth
                        helperText={
                          groups.error ? groups.error.message : groupItems.length === 0 && !groups.loading ? 'You are not in any group yet.' : ' '
                        }
                        error={groups.error !== null}
                      >
                        {groupItems.map((group) => (
                          <MenuItem key={group.id} value={group.id}>
                            {group.name}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                    <TextField
                      select
                      label="Role"
                      value={role}
                      onChange={(event) => setRole(event.target.value)}
                      size="small"
                      sx={{ minWidth: 140 }}
                      helperText=" "
                    >
                      {roles.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={share.pending || (mode === 'group' && !groupId)}
                      sx={{ flexShrink: 0 }}
                    >
                      Share
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            )}

            {shareError && (
              <Alert severity="error" sx={{ mb: 1 }} data-testid="share-error">
                {shareError}
              </Alert>
            )}

            {grants.loading && grants.data === null ? (
              <CircularProgress size={24} aria-label="Loading who this is shared with" />
            ) : grants.error ? (
              <Alert severity="error" action={<Button onClick={() => void grants.refresh()}>Retry</Button>}>
                {grants.error.message}
              </Alert>
            ) : grantItems.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Not shared with anyone yet.
              </Typography>
            ) : (
              <List dense aria-label="Shared with">
                {grantItems.map((grant) => {
                  const name = granteeName(grant);
                  return (
                    <ListItem
                      key={grant.id}
                      disableGutters
                      secondaryAction={
                        canWrite ? (
                          <Tooltip title="Remove access">
                            <IconButton edge="end" aria-label={`Remove access for ${name.primary}`} onClick={() => void revoke(grant)}>
                              <DeleteOutlineIcon />
                            </IconButton>
                          </Tooltip>
                        ) : undefined
                      }
                      sx={{ pr: canWrite ? 6 : 0, gap: 1, flexWrap: 'wrap' }}
                    >
                      <ListItemText primary={name.primary} secondary={name.secondary} sx={{ minWidth: 0 }} />
                      {canWrite ? (
                        <TextField
                          select
                          label="Role"
                          value={grant.role}
                          onChange={(event) => void changeRole(grant, event.target.value)}
                          size="small"
                          sx={{ minWidth: 130 }}
                          slotProps={{ select: { inputProps: { 'aria-label': `Role for ${name.primary}` } } }}
                        >
                          {roles.map((option) => (
                            <MenuItem key={option.value} value={option.value}>
                              {option.label}
                            </MenuItem>
                          ))}
                        </TextField>
                      ) : (
                        <Typography variant="body2">{roleLabel(roles, grant.role)}</Typography>
                      )}
                    </ListItem>
                  );
                })}
              </List>
            )}
          </Box>

          {/* ---- Section 2: link ---- */}
          {allowLinks && (
            <>
              <Divider />
              <Box component="section" aria-labelledby={`${ids}-links`}>
                <Typography id={`${ids}-links`} variant="subtitle1" component="h3" gutterBottom>
                  Link
                </Typography>
                {linksUnavailable(links.error) ? (
                  <Typography variant="body2" color="text.secondary" data-testid="links-unavailable">
                    Links are not available for this item.
                  </Typography>
                ) : (
                  <>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      Anyone with the link can open it, without signing in, until it expires or you revoke it.
                    </Typography>
                    {canWrite && (
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, mb: 2 }}>
                        <TextField
                          select
                          label="Link expires"
                          value={String(linkPreset)}
                          onChange={(event) => setLinkPreset(Number(event.target.value))}
                          size="small"
                          sx={{ minWidth: 150 }}
                        >
                          {presets.map((preset, index) => (
                            <MenuItem key={preset.label} value={String(index)}>
                              {preset.label}
                            </MenuItem>
                          ))}
                        </TextField>
                        {linkRoles.length > 1 && (
                          <TextField
                            select
                            label="Link role"
                            value={linkRole}
                            onChange={(event) => setLinkRole(event.target.value)}
                            size="small"
                            sx={{ minWidth: 140 }}
                          >
                            {linkRoles.map((option) => (
                              <MenuItem key={option.value} value={option.value}>
                                {option.label}
                              </MenuItem>
                            ))}
                          </TextField>
                        )}
                        <Button variant="outlined" onClick={() => void createLink()} disabled={links.pending}>
                          Create link
                        </Button>
                      </Stack>
                    )}
                    {linkError && (
                      <Alert severity="error" sx={{ mb: 1 }} data-testid="link-error">
                        {linkError}
                      </Alert>
                    )}
                    {links.loading && links.data === null ? (
                      <CircularProgress size={24} aria-label="Loading links" />
                    ) : links.error ? (
                      <Alert severity="error" action={<Button onClick={() => void links.refresh()}>Retry</Button>}>
                        {links.error.message}
                      </Alert>
                    ) : linkItems.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No active links.
                      </Typography>
                    ) : (
                      <List dense aria-label="Active links">
                        {linkItems.map((link) => (
                          <ListItem key={link.id} disableGutters sx={{ display: 'block' }}>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
                              {link.url ? (
                                <TextField
                                  value={link.url}
                                  label={link.label ?? 'Share link'}
                                  size="small"
                                  fullWidth
                                  onFocus={(event) => event.target.select()}
                                  helperText={
                                    copyFallback === link.id
                                      ? 'Select the link and copy it (Ctrl+C, or Cmd+C on a Mac).'
                                      : `${expiryText(link.expiresAt)} · ${roleLabel(linkRoles, link.role)}`
                                  }
                                  slotProps={{ htmlInput: { readOnly: true } }}
                                />
                              ) : (
                                <ListItemText
                                  primary={link.label ?? 'Share link'}
                                  secondary={`${expiryText(link.expiresAt)}. This link can no longer be copied; revoke it and create a new one.`}
                                />
                              )}
                              <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                                {link.url && (
                                  <Button startIcon={<ContentCopyIcon />} onClick={() => void copyLink(link)}>
                                    Copy
                                  </Button>
                                )}
                                {canWrite && (
                                  <Button color="error" startIcon={<LinkOffIcon />} onClick={() => void revokeLink(link)}>
                                    Revoke
                                  </Button>
                                )}
                              </Stack>
                            </Stack>
                          </ListItem>
                        ))}
                      </List>
                    )}
                  </>
                )}
              </Box>
            </>
          )}
        </Stack>
        <LiveRegion message={announcement} testId="share-dialog-status" />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
