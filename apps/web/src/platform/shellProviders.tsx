/**
 * The providers around the signed-in shell, outermost first: this app's
 * binding of the packaged shell's `ShellProviders` (issue #868). `App.tsx`
 * mounts them once, inside `RequireAuth`, around `Layout`:
 *
 *   <ShellProviders providers={APP_SHELL_PROVIDERS}><Layout /></ShellProviders>
 *
 * The ORDER is load-bearing, which is why it is one array:
 *
 *   1. `NotificationProvider` (#127, epic #109) wraps the SHELL, not the
 *      whole app: inside `RequireAuth` (every endpoint it calls is
 *      `@Auth()`-guarded), around `Layout` because the AppBar is where the
 *      bell lives, and ONE mount point means ONE SSE connection per tab.
 *   2. `AiConfigProvider` (#425, epic #419), for the same two reasons: ONE
 *      `GET /api/ai/config` shared by the chrome and every page.
 *   3. `TelemetryConfigProvider` (#537, epic #528), its twin for
 *      `GET /api/telemetry/config`; it takes the app's transport as a prop
 *      because it sits ABOVE the platform host (which reads its feature).
 *   4. `TelemetryWebAdaptersProvider` (#704), `JobsWebAdaptersProvider`
 *      (#854) and `DbBackupWebAdaptersProvider` (#740): the app's AI hooks,
 *      tables, spinner and clients for the packaged telemetry, jobs and
 *      Database Backup pages (`platform/*Adapters.ts`).
 *   5. `AppPlatformHostProvider` (#696), the platform host every packaged
 *      page reads: INSIDE the AI and telemetry providers, so the feature flags
 *      it exposes come from them, and inside `AuthProvider`, so the viewer is
 *      the signed-in user (`platform/platformHost.tsx`).
 *   6. `OnboardingProvider` (#745), innermost: one onboarding fetch per shell,
 *      through the platform host's transport.
 *
 * Each binding below is a module-level component, so its identity is stable
 * and React never remounts the stack on a re-render.
 */
import type { ReactNode } from 'react';
import { APP_NAME } from '@app/shared';
import { DbBackupWebAdaptersProvider } from '@marinoscar/platform-web/db-backup/headless';
import { JobsWebAdaptersProvider } from '@marinoscar/platform-web/jobs/headless';
import { NodesWebAdaptersProvider } from '@marinoscar/platform-web/nodes/headless';
import { NotificationProvider } from '@marinoscar/platform-web/notifications/headless';
import { OnboardingProvider } from '@marinoscar/platform-web/onboarding/headless';
import type { ShellProvider } from '@marinoscar/platform-web/shell/headless';
import {
  TelemetryConfigProvider,
  TelemetryWebAdaptersProvider,
} from '@marinoscar/platform-web/telemetry/headless';

import { AiConfigProvider } from '../contexts/AiConfigContext';
import { appDbBackupAdapters } from './dbBackupAdapters';
import { appJobsAdapters } from './jobsAdapters';
import { appNodesAdapters } from './nodesAdapters';
import { AppPlatformHostProvider, appPlatformApi } from './platformHost';
import { appTelemetryAdapters } from './telemetryAdapters';

function AppTelemetryConfigProvider({ children }: { children: ReactNode }) {
  return <TelemetryConfigProvider api={appPlatformApi}>{children}</TelemetryConfigProvider>;
}

function AppTelemetryAdaptersProvider({ children }: { children: ReactNode }) {
  return <TelemetryWebAdaptersProvider adapters={appTelemetryAdapters}>{children}</TelemetryWebAdaptersProvider>;
}

function AppJobsAdaptersProvider({ children }: { children: ReactNode }) {
  // The nodes provider is OUTSIDE the jobs one: the jobs provider bridges its own
  // adapters to the Worker Nodes page, and an outer nodes provider wins (#881).
  return (
    <NodesWebAdaptersProvider adapters={appNodesAdapters}>
      <JobsWebAdaptersProvider adapters={appJobsAdapters}>{children}</JobsWebAdaptersProvider>
    </NodesWebAdaptersProvider>
  );
}

function AppDbBackupAdaptersProvider({ children }: { children: ReactNode }) {
  return <DbBackupWebAdaptersProvider adapters={appDbBackupAdapters}>{children}</DbBackupWebAdaptersProvider>;
}

function AppOnboardingProvider({ children }: { children: ReactNode }) {
  return <OnboardingProvider appName={APP_NAME}>{children}</OnboardingProvider>;
}

export const APP_SHELL_PROVIDERS: readonly ShellProvider[] = [
  NotificationProvider,
  AiConfigProvider,
  AppTelemetryConfigProvider,
  AppTelemetryAdaptersProvider,
  AppJobsAdaptersProvider,
  AppDbBackupAdaptersProvider,
  AppPlatformHostProvider,
  AppOnboardingProvider,
];
