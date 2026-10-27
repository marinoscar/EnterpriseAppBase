import { z } from 'zod';

import type { SharingEnumEntries } from './constants.js';

/** `z.enum(values)`, typed as `ZodEnum<SharingEnumEntries<value>>` (a named entries type for the API reference). */
export function wireEnum<const T extends readonly [string, ...string[]]>(values: T): z.ZodEnum<SharingEnumEntries<T[number]>> {
  return z.enum(values) as unknown as z.ZodEnum<SharingEnumEntries<T[number]>>;
}
