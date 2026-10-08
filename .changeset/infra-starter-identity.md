---
"@marinoscar/platform-infra": patch
---

Name the disposable GreptimeDB test container after the app (`@@PLATFORM_TEST_CONTAINER@@-greptime`) instead of a fixed `my-app-greptime-test`, so an app renders no other app's identity, and point the fragments' comments at the CLI's packaged sources (`packages/platform-cli/src/engine/...`).
