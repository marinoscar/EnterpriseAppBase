# Runbook: platform drift report

Measure how far a consumer repository (a product forked from this template) has drifted from the base, file by file and module by module, with comment, whitespace and identity-rename noise ignored.

The tool is `scripts/platform-drift.mjs` (issue #674). It is maintainer tooling for the platform-packages program ([spec](../specs/platform-packages.md)), not an operator command: it compares two repositories, not two deployments, which is why it is a root script and not an `appctl` command.

## When you need it

- Before a retrofit: the drift baseline of the app you are about to move onto the platform packages.
- Before a backport: which base modules a fork changed, and how much.
- When a figure in the spec's [Measured drift](../specs/platform-packages.md#measured-drift) table needs refreshing.

## Prerequisites

- A checkout of this repository (the base) with `npm ci` run at its root. The script itself has no dependencies, but it resolves the `typescript` package from the base's `node_modules` to strip comments exactly. Without it the script exits 2 with "run npm ci first".
- A checkout of the consumer repository, at the commit you want to measure. Nothing is installed or built there, and nothing in either repository is written.
- Node 22 or later.

## Run it

From the base repository's root:

```bash
node scripts/platform-drift.mjs --app ../evopath
```

The report is written to `./drift-report/` (git-ignored): `drift-report.json` and `drift-report.md`. A summary line per area is printed. The exit code is 0 whenever the report was written, however large the drift (drift is data, not failure), and 2 for bad arguments, an unreadable path or a missing `typescript`.

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `--app <path>` | required | The consumer repository's root |
| `--base <path>` | this repository | The base repository's root |
| `--out <dir>` | `./drift-report` | Output directory, created if missing |
| `--format json\|md\|both` | `both` | Which reports to write; `md,json` means `both` |
| `--areas <a,b,...>` | every area present on either side | Any of `api`, `api-test`, `web`, `cli`, `prisma`, `infra`, `stack-agent`, `android`, `packages`, `scripts`, `github` |
| `--app-product-name`, `--app-repo-slug`, `--app-cli-name` | read from the app | Override the consumer's identity |
| `--base-product-name`, `--base-repo-slug`, `--base-cli-name` | read from the base | Override the base's identity |
| `--max-modified <n>` | `50` | Rows in the "most changed files" table |

Identity is read from `packages/shared/identity.json` (`productName`, `repoSlug`) and from the first key of `bin` in `apps/cli/package.json`. A repository without `identity.json` (MemoriaHub) needs the flags:

```bash
node scripts/platform-drift.mjs --app ../MemoriaHub \
  --app-product-name "MemoriaHub" --app-repo-slug marinoscar/MemoriaHub
```

## What is compared

| Area | Root | Module |
|---|---|---|
| `api` | `apps/api/src` | first path segment; files directly under the root are `(root)` |
| `api-test` | `apps/api/test` | first segment |
| `web` | `apps/web/src` | `components/<x>` and `pages/<x>`, else first segment |
| `cli` | `apps/cli/src` | first segment |
| `prisma` | `apps/api/prisma` | `schema.prisma`, `migrations`, `seed` |
| `infra` | `infra` | first segment (`compose`, `nginx`, `otel`) |
| `stack-agent` | `apps/stack-agent/src` | first segment |
| `android` | `apps/android` | first segment |
| `packages` | `packages` | package directory |
| `scripts` | `scripts` | file |
| `github` | `.github` | first segment |

An area missing on one side is reported (`not in base` or `not in app`), not an error. `node_modules`, `dist`, `build`, `coverage`, `.turbo`, `worktrees`, `.git`, Gradle and Python caches, `*.tsbuildinfo` and local `.env` files (never `.env.example`) are skipped.

## How a file is normalised

Before two text files are compared, both sides go through the same steps:

1. **Comments are removed.** TypeScript and JavaScript use the TypeScript parser, so `//` inside a string, a template literal, a regular expression or JSX text is never mistaken for a comment; a JSX comment `{/* ... */}` becomes `{}`. Prisma drops `//` and `///`; SQL drops `--` and block comments; YAML, shell, nginx, env examples and Dockerfiles drop `#` at line start or after whitespace, never inside quotes. Markdown is compared as text.
2. **Issue references are replaced** in code and Markdown: `(#598)` in a test name or `issue 600` in a string reads the same as `(#123)`, because each repository numbers its own issues.
3. **Identity values are replaced** by placeholders on both sides: `__PRODUCT__`, `__SLUG__`, `__SLUG_SNAKE__`, `__SERVICE__`, `__REPO_SLUG__`, `__REPO_NAME__`, `__CLI__`, `__CLI_UPPER__` (the env prefix `APPCTL_` becomes `__CLI_UPPER___`) and `__CLI_TITLE__`. Longest value first, and only where the value is not next to a letter or digit (`appctl` does not match inside `appctlx`, but does match in `APPCTL_TOKEN`). Base and app values are both replaced on both sides, so a fork that kept a base literal on purpose still matches.
4. **Whitespace is normalised**: `\r\n` becomes `\n`, every line is trimmed (indentation is ignored) and blank lines are dropped (Markdown keeps one between paragraphs).

The Markdown report starts with the replacement table, so you can see exactly what was ignored. A row marked "no" was unknown on one side and was not applied.

## How to read the report

### File statuses (`files[]` in the JSON)

| Status | Meaning |
|---|---|
| `identical` | byte-identical |
| `normalised-identical` | differs as bytes, identical after normalisation: noise only |
| `modified` | differs after normalisation; `linesAdded`/`linesRemoved` come from a line diff of the normalised text |
| `base-only` | exists only in the base |
| `app-only` | exists only in the consumer |

A binary file (a NUL byte in its first 8 KB) is `identical` or `modified` with `binary: true` and null line counts. A file over 20 000 normalised lines on either side is `modified` with `diffSkipped: true`.

### Areas and modules

Each area and module carries the five counts, the summed line changes of its modified files, and `identicalPercent`: identical plus normalised-identical over every **base** file there (present on both sides, or base-only). App-only files are not in the denominator, matching the spec's "API files identical to base (of 917)". It is `null` where the base has no file.

The Markdown sorts modules by changed lines, so the top of that table is where a fork really diverged. **Zero-drift modules** at the end lists modules where every file exists on both sides and is identical or normalised-identical: the candidates for early adoption.

### Migrations

Migrations (`apps/api/prisma/migrations/*/migration.sql`) are matched by normalised SQL first, then by the name after the 14-digit timestamp:

- `shared`: same id, same SQL.
- `renamed`: same SQL under a different id, such as `add_worker_node_vitals` landing under a different timestamp in a fork. Treat it as shared when baselining.
- `same-name-different-sql`: same name, different SQL. Read both before adopting a package migration.
- `base-only`, `app-only`.

### Prisma models

Models are parsed from `schema.prisma` (and any `*.prisma` under `prisma/schema/`). The report lists base models present in the app, missing from the app, app-only models, and for shared models the field names added or removed in the app. Field types and attributes are not compared.

### Reproducibility

Every array is sorted, so two runs on the same commits produce byte-identical JSON apart from `generatedAt`. Both commits are recorded (`base.commit`, `app.commit`; `null` outside a git checkout). The JSON carries `schemaVersion: 1`.

## Known limits

- A moved or renamed file is reported as `base-only` plus `app-only`; the script does not detect moves.
- Normalisation is textual. It cannot see semantic equivalence: reordered imports, a renamed local variable or reformatted code that changes line breaks all count as modified.
- Identity replacement is case-sensitive and boundary-bound: a camelCase identifier that embeds the CLI name (`appctlConfig`) is not replaced.
- Issue-reference replacement can hide a real change to a number written like an issue reference in code (`#123` between whitespace, brackets, quotes or `,.:`, or after the word issue, epic or PR). A quoted colour such as `'#123456'` is not affected, and CSS and YAML are never touched.
- Line counts are counts, not a diff. Use `git diff --no-index` on the two files for the content.

## How the program uses it

- The retrofit preparation stories (EvoPath, kvox, MemoriaHub) commit the report as their drift baseline, then classify each modified module as noise, a backport candidate or domain code.
- The backport story uses the module table and the zero-drift list to pick what moves into the base first.
- Each retrofit re-runs the report before it starts, because the stories are written months ahead.

When the script is wrong (a false `modified` or a false `normalised-identical`), file an issue against it with the two files; do not patch the report by hand.
