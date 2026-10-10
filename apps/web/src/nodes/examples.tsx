/**
 * Reference examples of the nodes slice's extension points (#881): the data
 * hooks the packaged Worker Nodes page is built on, used for "another view" of
 * the same records, and the page's header slot. The extension-point catalog of
 * `@marinoscar/platform-web/nodes` links each row here (the jobs catalog links
 * the same hooks, which `@marinoscar/platform-web/jobs` re-exports).
 *
 * Not mounted by this app: each is a small summary chip or binding a fork
 * could drop into a page or a dashboard card. They read through the nodes
 * client the app hands `NodesWebAdaptersProvider` (`platform/nodesAdapters.ts`),
 * so they carry the app's bearer token, refresh and maintenance handling, and
 * the API enforces the same permissions it enforces for the packaged page
 * (`nodes:read`/`nodes:write`).
 */
import { Button, Chip, Stack, Typography } from '@mui/material';
import {
  nodeCredentialStatus,
  useNodeActions,
  useNodeCredentials,
  useWorkerNode,
  useWorkerNodes,
} from '@marinoscar/platform-web/nodes/headless';
import { NodeCredentials, WorkersPage } from '@marinoscar/platform-web/nodes/ui';
import type { NodesPageHeaderProps } from '@marinoscar/platform-web/nodes/ui';

function SummaryChip({ label, isLoading, error }: { label: string; isLoading: boolean; error: string | null }) {
  return <Chip size="small" color={error ? 'error' : 'default'} label={isLoading ? '…' : (error ?? label)} />;
}

/** Healthy nodes out of the fleet (`useWorkerNodes`). */
export function FleetHealthSummary() {
  const { nodes, isLoading, error } = useWorkerNodes();
  const healthy = nodes.filter((node) => node.health === 'healthy').length;
  return <SummaryChip label={`${healthy}/${nodes.length} nodes healthy`} isLoading={isLoading} error={error} />;
}

/** One machine's health, for a node's own page (`useWorkerNode`). */
export function NodeHealthChip({ nodeId }: { nodeId: string }) {
  const { node, isLoading, error } = useWorkerNode(nodeId);
  return <SummaryChip label={node ? `${node.name}: ${node.health}` : 'Unknown node'} isLoading={isLoading} error={error} />;
}

/** Node credentials that can still authenticate (`useNodeCredentials`). */
export function ActiveNodeCredentialsSummary() {
  const { credentials, isLoading, error } = useNodeCredentials();
  const active = credentials.filter((credential) => nodeCredentialStatus(credential) === 'active').length;
  return <SummaryChip label={`${active} active node credentials`} isLoading={isLoading} error={error} />;
}

/** Revoke one credential from an incident checklist (`useNodeActions`). */
export function RevokeNodeCredentialButton({ credentialId, onRevoked }: { credentialId: string; onRevoked?: () => void }) {
  const { revokeCredential, isWorking } = useNodeActions(onRevoked);
  return (
    <Button size="small" color="error" disabled={isWorking} onClick={() => void revokeCredential(credentialId)}>
      Revoke
    </Button>
  );
}

/** The credential section on its own, for an incident-response surface (`NodeCredentials`). */
export function IncidentNodeCredentials() {
  const { credentials, isLoading, refresh } = useNodeCredentials();
  const { createCredential, revokeCredential, isWorking } = useNodeActions(() => void refresh());
  return (
    <NodeCredentials
      credentials={credentials}
      isLoading={isLoading}
      canWrite
      isWorking={isWorking}
      onCreate={createCredential}
      onRevoke={revokeCredential}
      now={new Date()}
    />
  );
}

/** A compact heading for the Worker Nodes page (the `slots.Header` slot). */
function CompactHeader({ title, description, readOnly }: NodesPageHeaderProps) {
  return (
    <Stack sx={{ mb: 2 }}>
      <Typography variant="h5" component="h1">
        {title}
        {readOnly ? ' (read-only)' : ''}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {description}
      </Typography>
    </Stack>
  );
}

/** The Worker Nodes page with a compact header. */
export function CompactWorkersPage() {
  return <WorkersPage slots={{ Header: CompactHeader }} />;
}
