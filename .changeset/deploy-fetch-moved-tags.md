---
"@marinoscar/platform-cli": patch
---

`deploy update` no longer stops at "Look for a new revision" when the app repository moves a tag. The deployment clone now fetches with `git fetch --tags --force --prune`, so a moved tag (a `stable` or `latest` marker) is updated in place instead of failing with "would clobber existing tag" (#1151).
