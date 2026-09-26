/**
 * AI (`/admin/settings/ai`) — PLACEHOLDER, issue #425 (epic #419).
 *
 * Scaffolded up front so the route, the registry entry and the permission
 * gates exist before the real page is built in parallel by #429. That story
 * replaces this file's body; the route, the gate and the default export stay.
 *
 * The page re-checks `ai_config:read` itself after its hooks, like every settings
 * page: the route's `RequirePermission` is the real gate, and this is defence
 * in depth for a render reached some other way.
 */
import { Container, Typography } from '@mui/material';
import { Navigate } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';

export default function AiConfigPage() {
  const { hasPermission } = usePermissions();

  if (!hasPermission('ai_config:read')) {
    return <Navigate to="/" replace />;
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2, md: 4 } }}>
      <Typography variant="h4" component="h1" gutterBottom>
        AI
      </Typography>
      <Typography variant="body1" color="text.secondary">
        Switch AI on for this deployment, choose whose keys pay for calls, and configure each provider.
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        Coming soon.
      </Typography>
    </Container>
  );
}
