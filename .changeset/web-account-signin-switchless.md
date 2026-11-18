---
"@marinoscar/platform-web": minor
---

`AccountSignInProviderCard` gains a switchless mode (#1006): `onEnabledChange` is now optional, and when a host omits it (because it chooses one provider among several elsewhere) the card renders no enable switch and treats `enabled` as the host's decision. `AccountSignInConsent` gains `onDecline?: () => Promise<void>`, which the consent dialog's **Not now** runs instead of the default `onEnabledChange(false)`, with the same busy and error handling; when neither is given, **Not now** is not rendered. Existing callers that pass `onEnabledChange` see no change.
