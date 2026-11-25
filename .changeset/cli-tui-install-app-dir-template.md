---
"@marinoscar/platform-cli": patch
---

The TUI Install screen now reads its questions from the app's own template, `<deployRoot>/repo/<appDir>/infra/compose/.env.example`, the same file the pipeline's environment step reads. Before, an app composed with `deploy.appDir` got no questions, and the install failed with "Cannot run without a terminal: N value(s) are missing or invalid" (#1163). Apps at the repository root are unchanged.
