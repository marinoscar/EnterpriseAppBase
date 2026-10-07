// Internal (not exported from the slice): `z.enum` typed through the named
// `TelemetryEnumEntries`, so a schema's type, and its generated reference,
// name the enum instead of spelling every entry out.
import { z } from 'zod';

import type { TelemetryEnumEntries } from './constants.js';

/** `z.enum(values)`, typed as `ZodEnum<TelemetryEnumEntries<value>>`. */
export function wireEnum<const T extends readonly [string, ...string[]]>(values: T): z.ZodEnum<TelemetryEnumEntries<T[number]>> {
  return z.enum(values) as unknown as z.ZodEnum<TelemetryEnumEntries<T[number]>>;
}
