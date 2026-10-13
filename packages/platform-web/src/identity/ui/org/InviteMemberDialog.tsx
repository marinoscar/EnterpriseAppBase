/**
 * The "Invite member" form of the Organization page (#726). Collects an
 * address, an org role and an optional private note; the API validates and
 * decides (a member or an accepted invitation is refused, and its message is
 * shown here).
 */
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import type { OrgRole, RoleDescriptor } from '../../headless/index.js';

interface InviteMemberDialogProps {
  open: boolean;
  onClose: () => void;
  onInvite: (data: { email: string; roleName: OrgRole; notes?: string }) => Promise<void>;
  /** The org roles the API says may be assigned (`GET /api/roles?scope=org`, `assignable` only). */
  roles: readonly RoleDescriptor[];
}

/** The role offered first: `viewer` (the least privileged built-in) when it is assignable, else the first one. */
function defaultRoleOf(roles: readonly RoleDescriptor[]): string {
  return (roles.find((role) => role.id === 'viewer') ?? roles[0])?.id ?? '';
}

export function InviteMemberDialog({ open, onClose, onInvite, roles }: InviteMemberDialogProps) {
  const [email, setEmail] = useState('');
  // `null` until the person picks one: the default follows the list as it loads.
  const [picked, setPicked] = useState<string | null>(null);
  const roleName = picked !== null && roles.some((role) => role.id === picked) ? picked : defaultRoleOf(roles);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reset() {
    setEmail('');
    setPicked(null);
    setNotes('');
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    if (!roleName) {
      setError('There is no role you can invite someone as');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await onInvite({ email: email.trim(), roleName, ...(notes.trim() ? { notes: notes.trim() } : {}) });
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send the invitation');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      fullWidth
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle>Invite member</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoFocus
              required
              fullWidth
              helperText="They join when they sign in with this address. It is added to the allowlist."
            />
            <FormControl fullWidth>
              <InputLabel id="invite-role">Role</InputLabel>
              <Select
                labelId="invite-role"
                label="Role"
                value={roleName}
                onChange={(event) => setPicked(event.target.value)}
              >
                {roles.map((role) => (
                  <MenuItem key={role.id} value={role.id}>
                    {role.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Notes (private, not emailed)"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              multiline
              minRows={2}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting || !roleName}>
            Send invitation
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
