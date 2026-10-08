/**
 * Organizations (#726, PP-6.7): the deployment's organizations, for its
 * operator. Reached through the `Organizations` card
 * (`/admin/settings/organizations`, the SYSTEM permission
 * `organizations:read`, `feature: 'orgs'`).
 *
 * Create (with the first administrator's email, who receives an `org_admin`
 * invitation) and rename are disabled without `organizations:write`; the API
 * enforces it, refuses a taken slug, and keeps the slug immutable after
 * creation. Deleting an organization is not offered (out of scope).
 */
import type { ReactElement, ReactNode } from 'react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { usePermissions } from '../../headless/index.js';
import { useOrganizations } from '../../headless/index.js';
import type { Organization } from '../../headless/index.js';

/** A slug suggestion from a name. The API validates the final value. */
function slugFrom(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

function CreateOrganizationDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; slug: string; firstAdminEmail: string }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [firstAdminEmail, setFirstAdminEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function close() {
    setName('');
    setSlug('');
    setSlugTouched(false);
    setFirstAdminEmail('');
    setError(null);
    onClose();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !slug.trim() || !firstAdminEmail.trim()) {
      setError('Name, slug and the first administrator are required');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), slug: slug.trim(), firstAdminEmail: firstAdminEmail.trim() });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the organization');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle>Create organization</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugTouched) setSlug(slugFrom(event.target.value));
              }}
              autoFocus
              required
              fullWidth
            />
            <TextField
              label="Slug"
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value);
              }}
              required
              fullWidth
              helperText="Lower-case letters, digits and hyphens. It cannot be changed later."
            />
            <TextField
              label="First administrator's email"
              type="email"
              value={firstAdminEmail}
              onChange={(event) => setFirstAdminEmail(event.target.value)}
              required
              fullWidth
              helperText="They receive an invitation and become the organization's administrator when they sign in."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            Create
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function RenameOrganizationDialog({
  organization,
  onClose,
  onRename,
}: {
  organization: Organization | null;
  onClose: () => void;
  onRename: (id: string, name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(organization?.name ?? '');
    setError(null);
  }, [organization]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!organization) return;
    try {
      await onRename(organization.id, name.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename the organization');
    }
  }

  return (
    <Dialog open={organization !== null} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle>Rename organization</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              required
              fullWidth
              helperText={organization ? `The slug stays ${organization.slug}.` : undefined}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={!name.trim()}>
            Rename
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/**
 * Props of {@link OrganizationsPage}.
 *
 * @stability experimental
 */
export interface OrganizationsPageProps {
  /**
   * Extra actions of one organization row, rendered after Rename: the slot
   * another slice registers an action through (the user-data slice's
   * `OffboardOrganizationButton`, #743). `refresh` reloads the list.
   */
  renderActions?(organization: Organization, helpers: { refresh(): void }): ReactNode;
}

/**
 * The `Organizations` page (`/admin/settings/organizations`): the
 * deployment's organizations, for operators holding `organizations:read`.
 *
 * @param props - see {@link OrganizationsPageProps}.
 * @returns the page.
 *
 * @extensionPoint component
 * @stability stable
 */
export function OrganizationsPage(props: OrganizationsPageProps = {}): ReactElement {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission('organizations:write');
  const { organizations, total, isLoading, error, fetchOrganizations, createOrg, renameOrg } = useOrganizations();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [renaming, setRenaming] = useState<Organization | null>(null);

  useEffect(() => {
    void fetchOrganizations({ page: 1, pageSize: 100, search: search.trim() || undefined });
  }, [fetchOrganizations, search]);

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Organizations
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Every organization in this deployment. A new organization starts with an invitation for its first
          administrator.
        </Typography>

        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
            <TextField
              label="Search organizations"
              size="small"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              sx={{ maxWidth: { sm: 360 } }}
            />
            <Box sx={{ flexGrow: 1 }} />
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              disabled={!canWrite}
              onClick={() => setCreateOpen(true)}
            >
              Create organization
            </Button>
          </Stack>

          {error && <Alert severity="error">{error}</Alert>}
          {!isLoading && organizations.length === 0 && !error && (
            <Typography color="text.secondary">No organizations match.</Typography>
          )}

          {organizations.map((organization) => (
            <Paper key={organization.id} variant="outlined" sx={{ p: 2 }} data-testid={`org-${organization.id}`}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontWeight: 600 }}>
                    {organization.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {organization.slug} &middot; {organization.memberCount}{' '}
                    {organization.memberCount === 1 ? 'member' : 'members'}
                  </Typography>
                </Box>
                {organization.isDefault && (
                  <Chip label="Default" size="small" sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }} />
                )}
                <Button size="small" variant="outlined" disabled={!canWrite} onClick={() => setRenaming(organization)}>
                  Rename
                </Button>
                {props.renderActions?.(organization, {
                  refresh: () => void fetchOrganizations({ page: 1, pageSize: 100, search: search.trim() || undefined }),
                })}
              </Stack>
            </Paper>
          ))}

          {total > organizations.length && (
            <Typography variant="body2" color="text.secondary">
              Showing {organizations.length} of {total}. Search to narrow the list.
            </Typography>
          )}
        </Stack>

        <CreateOrganizationDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreate={createOrg} />
        <RenameOrganizationDialog organization={renaming} onClose={() => setRenaming(null)} onRename={renameOrg} />
      </Box>
    </Container>
  );
}
