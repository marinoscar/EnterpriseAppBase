/**
 * The public maintenance screen, bound to this app's name (`@app/shared`).
 *
 * The screen is `@marinoscar/platform-web/host/ui`'s (#891); `MaintenanceGate`
 * (`components/common/MaintenanceGate.tsx`) decides when it replaces the
 * application.
 */

import { MaintenanceScreen } from '@marinoscar/platform-web/host/ui';
import type { MaintenanceScreenProps } from '@marinoscar/platform-web/host/ui';
import { APP_NAME } from '@app/shared';

export type MaintenancePageProps = Omit<MaintenanceScreenProps, 'appName'>;

export default function MaintenancePage({ block, onRetry }: MaintenancePageProps) {
  return <MaintenanceScreen appName={APP_NAME} block={block} onRetry={onRetry} />;
}
