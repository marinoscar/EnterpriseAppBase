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
import { ORG_ROLES, type OrgRole } from '../../headless/index.js';
import { orgRoleLabel } from './orgLabels.js';

interface InviteMemberDialogProps {
  open: boolean;
  onClose: () => void;
  onInvite: (data: { email: string; roleName: OrgRole; notes?: string }) => Promise<void>;
}

export function InviteMemberDialog({ open, onClose, onInvite }: InviteMemberDialogProps) {
  const [email, setEmail] = useState('');
  const [roleName, setRoleName] = useState<OrgRole>('viewer');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reset() {
    setEmail('');
    setRoleName('viewer');
    setNotes('');
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) {
      setError('Email is required');
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
                onChange={(event) => setRoleName(event.target.value as OrgRole)}
              >
                {ORG_ROLES.map((role) => (
                  <MenuItem key={role} value={role}>
                    {orgRoleLabel(role)}
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
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            Send invitation
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
