import { z } from 'zod';

import type { WebhookEnumEntries } from './constants.js';

/** `z.enum(values)`, typed as `ZodEnum<WebhookEnumEntries<value>>` (a named entries type for the API reference). */
export function wireEnum<const T extends readonly [string, ...string[]]>(values: T): z.ZodEnum<WebhookEnumEntries<T[number]>> {
  return z.enum(values) as unknown as z.ZodEnum<WebhookEnumEntries<T[number]>>;
}
