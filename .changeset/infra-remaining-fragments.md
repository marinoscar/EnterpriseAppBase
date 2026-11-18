---
"@marinoscar/platform-infra": minor
---

Ship the base, dev, devdb, prod, vps, worker, worker.build and test compose fragments, nginx.conf with its app include points and the security-headers and SSE snippets, and the env templates; render the app identity into them on `platform-infra sync` (`--identity`), and order each mode's compose files with the app's `app.*.compose.yml` overlays last (`composeFilesForMode`, `appComposeOverlays`).
