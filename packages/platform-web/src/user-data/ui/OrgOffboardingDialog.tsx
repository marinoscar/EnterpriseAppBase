// The organization offboarding dialog (issue #743): the summary of what goes,
// the preconditions with their verdicts, what happens to members left without
// an organization, a skip reason when a precondition fails, and the slug as
// the phrase. Launched by `OffboardOrganizationButton` from the organizations
// page (an action the app registers on it).

import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FormControl, FormControlLabel, FormLabel, List, ListItem, ListItemText, Radio, RadioGroup, TextField, Typography } from '@mui/material';
import type { OffboardingUserDisposition, OrgOffboardingResult, OrgOffboardingSummary } from '@marinoscar/platform-contract/user-data';

import { usePlatformApi } from '../../core/index.js';
import { createOrgOffboardingClient, useDestructiveJob } from '../headless/index.js';
import { TypedConfirmDialog } from './TypedConfirmDialog.js';

/**
 * The organization being offboarded.
 *
 * @stability experimental
 */
export interface OffboardedOrganization {
  /** Its id. */
  id: string;
  /** Its name. */
  name: string;
  /** Its slug: the confirmation phrase. */
  slug: string;
}

/**
 * Props of {@link OrgOffboardingDialog}.
 *
 * @stability experimental
 */
export interface OrgOffboardingDialogProps {
  /** The organization, or `null` when closed. */
  organization: OffboardedOrganization | null;
  /** Called to close (never while running). */
  onClose(): void;
  /** Called after the offboarding succeeds (refresh the organization list). */
  onCompleted?(result: OrgOffboardingResult | null): void;
  /** Poll interval in milliseconds. Default 1500. */
  pollIntervalMs?: number;
}

/**
 * The offboarding dialog. See the file header.
 *
 * @param props - see {@link OrgOffboardingDialogProps}.
 *
 * @stability experimental
 * @extensionPoint component
 * @example
 * ```tsx
 * <OrgOffboardingDialog organization={selected} onClose={() => setSelected(null)} onCompleted={refresh} />
 * ```
 */
export function OrgOffboardingDialog(props: OrgOffboardingDialogProps): ReactElement {
  const api = usePlatformApi();
  const client = useMemo(() => createOrgOffboardingClient(api), [api]);
  const org = props.organization;
  const [summary, setSummary] = useState<OrgOffboardingSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [disposition, setDisposition] = useState<OffboardingUserDisposition>('keep');
  const [skipReason, setSkipReason] = useState('');

  useEffect(() => {
    setSummary(null);
    setLoadError(null);
    setDisposition('keep');
    setSkipReason('');
    if (!org) return;
    client.summary(org.id).then(setSummary, (err: unknown) => setLoadError(err instanceof Error ? err.message : 'Could not load the summary'));
  }, [client, org]);

  const failing = summary?.preconditions.filter((check) => !check.passed) ?? [];
  const job = useDestructiveJob<OrgOffboardingResult>({
    start: () =>
      client.request(org!.id, {
        confirmation: org!.slug,
        userDisposition: disposition,
        ...(failing.length > 0 ? { skipExport: { reason: skipReason.trim() } } : {}),
      }),
    poll: (jobId) => client.status(org!.id, jobId),
    intervalMs: props.pollIntervalMs,
    onSucceeded: (result) => props.onCompleted?.(result),
  });
  const counts = job.result?.counts ?? {};

  return (
    <TypedConfirmDialog
      open={org !== null}
      title={org ? `Offboard ${org.name}` : ''}
      description={
        <>
          <Typography gutterBottom>
            Deletes the organization, every record and file it owns, its invitations and its memberships. This cannot be undone.
          </Typography>
          {loadError && <Alert severity="warning">{loadError}</Alert>}
          {summary && (
            <List dense aria-label="What is deleted">
              <ListItem disableGutters>
                <ListItemText primary={`Members: ${summary.members}, invitations: ${summary.invites}, stored files: ${summary.storageObjects}`} />
              </ListItem>
              {Object.entries(summary.models)
                .filter(([, count]) => count > 0)
                .map(([model, count]) => (
                  <ListItem key={model} disableGutters>
                    <ListItemText primary={`${model}: ${count}`} />
                  </ListItem>
                ))}
            </List>
          )}
          {failing.map((check) => (
            <Alert key={check.id} severity="warning" sx={{ mb: 1 }}>
              {check.label}: {check.message ?? 'not met'}
            </Alert>
          ))}
        </>
      }
      phrase={org?.slug ?? ''}
      confirmLabel="Offboard"
      phase={job.phase}
      error={job.error}
      canConfirm={failing.length === 0 || skipReason.trim().length >= 3}
      resultRows={Object.entries(counts)
        .filter(([key]) => key !== 'storageObjectsFailed')
        .map(([label, count]) => ({ label, count }))}
      storageObjectsFailed={counts.storageObjectsFailed ?? 0}
      onConfirm={() => void job.run()}
      onClose={() => {
        job.reset();
        props.onClose();
      }}
    >
      <FormControl sx={{ mb: 1 }}>
        <FormLabel id="offboard-disposition">
          Members left without an organization{summary ? ` (${summary.usersLeftWithoutOrg})` : ''}
        </FormLabel>
        <RadioGroup aria-labelledby="offboard-disposition" value={disposition} onChange={(event) => setDisposition(event.target.value as OffboardingUserDisposition)}>
          <FormControlLabel value="keep" control={<Radio />} label="Keep their accounts (they cannot sign in until invited)" />
          <FormControlLabel value="purge" control={<Radio />} label="Delete their data and their accounts" />
        </RadioGroup>
      </FormControl>
      {failing.length > 0 && (
        <TextField
          label="Why go ahead anyway (recorded in the audit log)"
          value={skipReason}
          onChange={(event) => setSkipReason(event.target.value)}
          fullWidth
          margin="dense"
        />
      )}
    </TypedConfirmDialog>
  );
}
