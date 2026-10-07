// The credential store's meaning of "blank" on write (issue #703): `undefined`,
// `null` and `""` mean "no value supplied". Copied from the app's
// `credentials/credential-internals.ts` (`isBlankSecret`) so the telemetry
// slice does not import the credentials module; the two must agree, which
// `internal.spec.ts` pins the rule. Internal to the
// slice: not exported.

/** Whether `secret` counts as "not supplied". */
export function isBlankSecret(secret: string | null | undefined): secret is null | undefined | '' {
  return secret === undefined || secret === null || secret === '';
}
