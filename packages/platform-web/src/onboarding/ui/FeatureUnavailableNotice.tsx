// =============================================================================
// FeatureUnavailableNotice (issue #745): "{Feature} isn't enabled yet"
// =============================================================================
//
// Shown in place of a control that cannot work because the feature behind it
// is not set up (AI, object storage, Web Push, an app's own), so it neither
// vanishes silently nor fails on use. A viewer holding the feature's admin
// permission sees "Set it up", a link to the admin page; everyone else reads
// that their administrator has not set it up. The permission only picks the
// words: the admin route and the API enforce their own gates.
// =============================================================================

import { Alert, AlertTitle, Button } from '@mui/material';
import type { ReactElement } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import { usePlatformViewer } from '../../core/index.js';
import { featureNoticeFor } from '../headless/feature-notices.js';
import { FEATURE_SET_UP_LABEL, FEATURE_UNAVAILABLE_BODY } from './copy.js';

/**
 * What {@link FeatureUnavailableNotice} takes.
 *
 * @stability experimental
 */
export interface FeatureUnavailableNoticeProps {
  /** The feature (`ai`, `storage`, `push`, or one registered with `registerFeatureNotice`). */
  feature: string;
  /** An extra sentence, such as what still works. */
  detail?: string;
}

/**
 * "<Feature> isn't enabled yet", with "Set it up" for the feature's
 * administrators.
 *
 * @param props - see {@link FeatureUnavailableNoticeProps}.
 * @returns the notice.
 * @throws Error when no notice is registered for `feature`.
 *
 * @example
 * ```tsx
 * {aiEnabled ? <AskButton /> : <FeatureUnavailableNotice feature="ai" />}
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function FeatureUnavailableNotice({ feature, detail }: FeatureUnavailableNoticeProps): ReactElement {
  const viewer = usePlatformViewer();
  const notice = featureNoticeFor(feature);
  if (!notice) throw new Error(`FeatureUnavailableNotice: no notice is registered for "${feature}" (registerFeatureNotice).`);
  const canSetUp = viewer.hasPermission(notice.adminPermission);
  const text = [canSetUp ? null : FEATURE_UNAVAILABLE_BODY, detail ?? null].filter(Boolean).join(' ');

  return (
    <Alert
      severity="info"
      data-testid={`feature-unavailable-${feature}`}
      action={
        canSetUp ? (
          <Button component={RouterLink} to={notice.setupHref} variant="outlined" size="small" sx={{ minHeight: 36 }}>
            {FEATURE_SET_UP_LABEL}
          </Button>
        ) : null
      }
      sx={{ '& .MuiAlert-action': { alignItems: 'center', pt: 0 } }}
    >
      <AlertTitle sx={{ mb: text ? 0.5 : 0 }}>{`${notice.label} isn't enabled yet`}</AlertTitle>
      {text || null}
    </Alert>
  );
}
