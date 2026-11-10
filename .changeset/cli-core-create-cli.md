---
"@marinoscar/platform-cli": minor
"@marinoscar/platform-infra": patch
---

Move the CLI into `@marinoscar/platform-cli`: `createCli({ identity, version, extraCommands, tuiScreens, deploySteps, nodeExecutors, envSpecFragments })` builds an app's CLI (the `init`, `login`, `api`, `config`, `node` and `deploy` commands, the TUI, the deploy pipeline and the worker engine) with the identity as configuration; add the `/commands`, `/tui`, `/deploy`, `/node`, `/api-client` and `/testing` entry points, the `registerTuiScreen`, `registerDeployStep` and `registerNodeExecutor` registries, the credential-hygiene check and the `cli` conformance suite. platform-infra: point its README examples at the reference app now that the CLI lives in a package.
