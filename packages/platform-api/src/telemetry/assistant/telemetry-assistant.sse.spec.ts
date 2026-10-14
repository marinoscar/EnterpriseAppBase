import { formatTelemetrySseFrame } from './telemetry-assistant.sse';

// The stream itself (hijack, headers, heartbeat) is proved through the app's
// configured controller: apps/api/test/telemetry/telemetry-assistant.controller.spec.ts.
describe('formatTelemetrySseFrame', () => {
  it('formats one frame per event on a single data line', () => {
    expect(formatTelemetrySseFrame('error', { code: 'X', message: 'a\nb' })).toBe(
      'event: error\ndata: {"code":"X","message":"a\\nb"}\n\n',
    );
  });
});
