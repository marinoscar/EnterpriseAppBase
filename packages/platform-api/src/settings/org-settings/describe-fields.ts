// =============================================================================
// Org-overridable fields, described for a generated form (issue #733)
// =============================================================================
//
// The organization settings page cannot import an app's zod schemas, so the API
// describes each field of a namespace's `org.schema` as one of five kinds:
// boolean, enum (with its options), number (with its bounds), string (with its
// maximum length) and `other` (anything else: the page links to the owning
// slice's own page instead of rendering a control). Wrappers (`optional`,
// `nullable`, `readonly`) are unwrapped first.
//
// Since PP-14.5 (issue #923) the description itself lives in
// `core/pluggable/describe-config-fields.ts`, shared with the pluggable-kind
// primitive. This file keeps the org-settings contract exactly as it was: the
// shared description also carries `label` and `help`, which the org settings
// wire shape (`orgSettingsFieldSchema`) does not, so they are dropped here and
// the organization settings response stays byte-identical.
// =============================================================================

import type { OrgSettingsField } from '@marinoscar/platform-contract/settings';
import { z } from 'zod';

import { describeConfigField } from '../../core/index';

/** The descriptor of one field. */
export function describeOrgField(name: string, schema: z.ZodType): OrgSettingsField {
  // `describeConfigField` never yields a `secret`, and without `label` and `help` the rest is an org settings field.
  const { label: _label, help: _help, ...field } = describeConfigField(name, schema);
  return field as unknown as OrgSettingsField;
}

/** The descriptors of every field of an `org.schema`, in declaration order. */
export function describeOrgFields(schema: z.ZodObject<z.ZodRawShape>): OrgSettingsField[] {
  return Object.entries(schema.shape as Record<string, z.ZodType>).map(([name, field]) => describeOrgField(name, field));
}
