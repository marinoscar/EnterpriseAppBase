/**
 * Admin → Settings → Web Push (`/admin/settings/push`).
 *
 * Issue #355. A STANDALONE PAGE, exactly like `EmailSettingsPage.tsx` and for
 * the same reason: this hits its own controller (`/api/admin/push-config`)
 * with its own document, not the generic `system_settings` blob `SettingsHub`
 * pages share — see `CLAUDE.md`'s "MANDATORY: Settings UI Pattern" §2 and
 * `docs/specs/settings-ui.md`. One entry in `ADMIN_SECTIONS`
 * (`config/adminSections.tsx`), one route in `App.tsx` gated on the same
 * `push:read` string, no tab anywhere.
 *
 * SCAFFOLD STAGE: loading/error states and the permission gate only. The
 * status panel, the generate flow and the configured-state controls land in
 * follow-up commits, wired to `usePushConfig` (`hooks/usePushConfig.ts`).
 */

import { Box, Container, Typography } from '@mui/material';
import { Navigate } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { usePushConfig } from '../../hooks/usePushConfig';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';

export default function PushConfigPage() {
  const { hasPermission } = usePermissions();
  const { config, isLoading, loadError } = usePushConfig();

  // Defence, not the gate — `App.tsx` wraps the route in `RequirePermission`
  // with this same string. This one catches the page mounted from anywhere
  // else. It sits after every hook so the hook order never changes.
  if (!hasPermission('push:read')) {
    return <Navigate to="/" replace />;
  }

  if (isLoading || !config) {
    if (loadError) {
      return (
        <Container maxWidth="lg">
          <Box sx={{ py: 4 }}>
            <Typography variant="h4" component="h1" gutterBottom>
              Web Push
            </Typography>
            <Typography color="error">{loadError}</Typography>
          </Box>
        </Container>
      );
    }
    return <LoadingSpinner />;
  }

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Web Push
        </Typography>
        <Typography color="text.secondary">
          Generate a VAPID key pair, enable or rotate it, and control whether this deployment can
          send browser push notifications.
        </Typography>
      </Box>
    </Container>
  );
}
