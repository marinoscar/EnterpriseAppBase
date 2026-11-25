---
"@marinoscar/platform-cli": minor
---

Add `@marinoscar/platform-cli/android` (#746): the merged `android` command group (`androidCommand`: doctor with a printed `--fix` plan and `--dry-run`, keystore, version, build, publish with `--trust`, release, releases), the optional `androidDeployStep` (opted in with `<PREFIX>DEPLOY_ANDROID=1`) and `androidTuiScreen`. The engine's `ApiClient` accepts a `formData` request body.
