/**
 * EXAMPLE (PP-14.21): an organization settings field the page cannot draw.
 *
 * `telemetry.query` is an object, so `GET /api/org-settings` describes it as
 * kind `other` and the generated page would only say it is managed elsewhere.
 * The API example `examples/telemetry-query.extension.ts` makes
 * `telemetry.query.slowQuerySeconds` organization-tightenable. This renderer
 * draws that one number and registers itself for the field:
 *
 *   registerOrgSettingsFieldRenderer('telemetry', 'query', SlowQueryField);
 *
 * Every other field of every namespace keeps the generated control. `value` is
 * the organization's draft or stored object, `inherited` the effective one;
 * `onChange(null)` removes the override.
 */
import { TextField } from '@mui/material';
import { registerOrgSettingsFieldRenderer } from '@marinoscar/platform-web/settings/headless';
import type { OrgSettingsFieldRendererProps } from '@marinoscar/platform-web/settings/headless';

/** The control for `telemetry.query.slowQuerySeconds`. */
export function SlowQueryField({ value, inherited, disabled, onChange }: OrgSettingsFieldRendererProps) {
  const own = (value as { slowQuerySeconds?: number } | undefined)?.slowQuerySeconds;
  const effective = (inherited as { slowQuerySeconds?: number } | undefined)?.slowQuerySeconds;
  return (
    <TextField
      type="number"
      size="small"
      label="Slow query threshold (seconds)"
      value={own ?? ''}
      placeholder={effective === undefined ? undefined : String(effective)}
      disabled={disabled}
      helperText="You can lower the deployment's threshold for your members, never raise it."
      slotProps={{ htmlInput: { min: 1, max: 120, step: 1 } }}
      onChange={(event) => onChange(event.target.value === '' ? null : { slowQuerySeconds: Number(event.target.value) })}
      sx={{ minWidth: 280 }}
    />
  );
}

/** Registers {@link SlowQueryField}. Call at module scope, before the page renders. */
export function registerSlowQueryField(): () => void {
  return registerOrgSettingsFieldRenderer('telemetry', 'query', SlowQueryField);
}
