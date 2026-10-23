---
"@marinoscar/platform-cli": patch
---

Deploy checks now know the deployment's compose project: `CheckContext` and the narrow `DeployCheckContext` handed to `registerDeployCheck` carry `composeProject` (the recorded project, `compose` for a deployment installed before it was recorded). `bind-port-free` recognises its own containers by that project instead of the folder name, so a legacy-project deployment is no longer refused by its own `compose-nginx-1` during `update` or `doctor`.
