---
"@marinoscar/platform-db": minor
---

Platform history v1: the base's 22 migrations ship in `migrations/` (`0001_initial` to `0022_add_retention_created_at_indexes`, byte-identical to the app copies) with a filled `manifest.json` (an entry may list the other slices it `touches`), and the raw-SQL index list becomes the exported `RAW_SQL_INDEXES` with a tripwire (`assertRawSqlIndexes`) that fails on an unlisted partial or expression index.
