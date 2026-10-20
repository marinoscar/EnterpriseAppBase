---
"@marinoscar/platform-web": patch
---

`AccountSignInProviderCard` (`@marinoscar/platform-web/ai/ui`) takes `signInUnavailableReason`: while it is set and the user is signed out, Sign in is disabled, the reason is shown under the buttons and tied to the button with `aria-describedby`, and Try again never starts a sign-in. Unset, nothing changes. A host whose provider needs a step first (a runtime to install) says so instead of offering a sign-in that fails (#1003).
