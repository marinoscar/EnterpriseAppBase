/**
 * Whether the telemetry AI assistant may be offered to this viewer — issue
 * #579 (extracted from the Telemetry Explorer, #537), epic #576.
 *
 * ONE condition, shared by every page that offers the assistant (the Telemetry
 * Explorer and the Telemetry Dashboard), so the two can never disagree:
 *
 *   - the assistant is switched on in the Telemetry settings
 *     (`GET /api/telemetry/config` → `assistantEnabled`),
 *   - AI is switched on for the deployment (the app's `useAiEnabled` adapter;
 *     in the reference app `GET /api/ai/config` → `enabled`),
 *   - the viewer holds `ai:use`.
 *
 * This only HIDES the control. The API enforces every one of those on
 * `POST /admin/telemetry/assistant/stream` regardless.
 */
import { usePlatformViewer } from '../../../core/index.js';
import { useTelemetryWebAdapters } from '../adapters/TelemetryWebAdapters.js';
import { useTelemetryConfig } from '../context/telemetryConfig.js';

/**
 * Whether the telemetry assistant may be offered to this viewer: switched on
 * in the Telemetry settings, AI switched on for the deployment (the app's
 * {@link TelemetryWebAdapters.useAiEnabled}) and the viewer holds `ai:use`.
 * It only hides the control; the API enforces every condition.
 *
 * @returns `true` when all three hold.
 *
 * @stability experimental
 */
export function useTelemetryAssistantAvailable(): boolean {
  const { hasPermission } = usePlatformViewer();
  const { config: telemetryConfig } = useTelemetryConfig();
  const { enabled: aiEnabled } = useTelemetryWebAdapters().useAiEnabled();
  return telemetryConfig.assistantEnabled && aiEnabled && hasPermission('ai:use');
}
