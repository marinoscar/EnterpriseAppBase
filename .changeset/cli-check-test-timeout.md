---
"@marinoscar/platform-cli": patch
---

Test-only change: the deploy-checks registry test (`gives every non-passing check a remedy, across the whole registry`) now allows 30 s instead of vitest's default 5 s, because `database-reachable` makes a real TCP connection with its own 5 s timeout that the check context cannot fake, and a loaded CI runner could hit the limit. No runtime change; the six packages move together (fixed group) and this version is also the first release through trusted publishing.
