// Shared fixtures of the email slice's tests (issue #737).
import { configureEmailRendering, createEmailRenderContext } from '../../src/email/templates/render-context';
import { registerPlatformEmailTemplates } from '../../src/email/templates/email-template.registry';

/** The product name the byte-for-byte fixtures were captured with (the reference app's). */
export const TEST_APP_NAME = 'My App';

/** Configures rendering with the default layout and registers the platform templates, as `EmailModule.forRoot` does. */
export function configureTestEmail(): void {
  configureEmailRendering({ appName: TEST_APP_NAME });
  registerPlatformEmailTemplates();
}

/** A default-layout render context. */
export const TEST_RENDER_CONTEXT = createEmailRenderContext({ appName: TEST_APP_NAME });

/**
 * A stand-in for the job queue's `classifyRateLimit` (the generic HTTP / SDK
 * classifier the reference app passes as `EmailModule.forRoot({ classifyRateLimit })`):
 * HTTP 429/503/529, the AWS throttle names, a seconds `Retry-After`. The real
 * composition is proven in the app (apps/api/src/platform/email/email-rate-limit.spec.ts).
 */
export function fakeQueueClassifier(err: unknown, now: number): { rateLimited: boolean; retryAfterMs: number | null } {
  void now;
  if (err === null || typeof err !== 'object') return { rateLimited: false, retryAfterMs: null };
  const candidate = err as { name?: unknown; $metadata?: { httpStatusCode?: unknown }; headers?: Record<string, unknown> };
  const status = candidate.$metadata?.httpStatusCode;
  const byStatus = status === 429 || status === 503 || status === 529;
  const byName = typeof candidate.name === 'string' && /^(Throttling|ThrottlingException|TooManyRequestsException)$/.test(candidate.name);
  if (!byStatus && !byName) return { rateLimited: false, retryAfterMs: null };
  const retryAfter = Number(candidate.headers?.['retry-after']);
  return { rateLimited: true, retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null };
}
