import { z } from 'zod';

import type { AlertEnumEntries } from './constants.js';

/** `z.enum(values)`, typed as `ZodEnum<AlertEnumEntries<value>>` (a named entries type for the API reference). */
export function wireEnum<const T extends readonly [string, ...string[]]>(values: T): z.ZodEnum<AlertEnumEntries<T[number]>> {
  return z.enum(values) as unknown as z.ZodEnum<AlertEnumEntries<T[number]>>;
}
