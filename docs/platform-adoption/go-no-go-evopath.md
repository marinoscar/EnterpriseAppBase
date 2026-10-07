# Go/no-go gate: the cost of one platform change across the base and EvoPath

The platform-packages program's gate after wave 3 ([spec: Go/no-go gate](../specs/platform-packages.md#gono-go-gate-after-wave-3)), measured on 2026-10-07 for [issue 720](https://github.com/marinoscar/EnterpriseAppBase/issues/720) (PP-10.5). EvoPath is the only adopting app so far; kvox and MemoriaHub are projected, not measured.

## Contents

- [1. Summary verdict](#1-summary-verdict)
- [2. The representative change](#2-the-representative-change)
- [3. Metrics, both routes](#3-metrics-both-routes)
- [4. The decision rule, evaluated](#4-the-decision-rule-evaluated)
- [5. Real-pipeline calibration: the deriveSigningKey seam cycle](#5-real-pipeline-calibration-the-derivesigningkey-seam-cycle)
- [6. Projection to three apps (estimate)](#6-projection-to-three-apps-estimate)
- [7. How much platform code left EvoPath](#7-how-much-platform-code-left-evopath)
- [8. Friction log](#8-friction-log)
- [9. Learnings](#9-learnings)
- [10. What must change before a re-run](#10-what-must-change-before-a-re-run)
- [11. Recommendation for issue 747 onwards](#11-recommendation-for-issue-747-onwards)
- [Appendix A: raw commands and outputs](#appendix-a-raw-commands-and-outputs)

## 1. Summary verdict

**Computed verdict: `GATE: NO-GO`.** No owner override is recorded.

| | Result |
|---|---|
| Hard conditions | H1 holds, H3 holds, **H2 fails**: the pipeline the spec describes (npm `next`, the `platform-next.yml` run, `latest`, a Renovate PR) has never run, because the packages are not on npm yet. EvoPath consumed `0.1.0-next.1` to `next.3` through the interim GitHub-release channel, by hand-edited URL pins. |
| Efficiency conditions | 0 of 3 hold as written: **E1 fails** (6 files changed in EvoPath on the package route; the threshold is 3), **E2 is not established** (on agent minutes alone the routes cost about the same; it holds only with review estimates the owner has not given), **E3 fails** its `latest` clause (no promotion is possible in pre-release mode without npm; the `next` part took 6 h 12 min). |
| What the numbers do show | On the package route EvoPath touched **0 production code files** and 15 lines (4 version pins, 1 app test line, 1 ledger note). The same change by copy touched **7 production code files** and 150 lines in 11 files; 28 of 40 hunks did not apply (15 rejected, 13 with no target file) and had to be re-designed by hand, because the copy has no `forRoot` options object. kvox and MemoriaHub have no telemetry slice, so the change is **not portable to them by copy at all**. |

The packaging premise (spec D1) is supported by the code-level evidence. What the gate cannot yet confirm is the release pipeline the premise depends on: every hard failure traces back to one owner prerequisite (npm publishing) and to the metric definitions, not to a design flaw in the packages. Per the decision rule, waves 0 to 3 and the database spike stay; [issue 665](https://github.com/marinoscar/EnterpriseAppBase/issues/665) and later do not start until a re-run records GO, or the owner overrides with a reason. [Section 10](#10-what-must-change-before-a-re-run) lists what a re-run needs; most of it is owner steps.

## 2. The representative change

**Selection rule applied: rule 4 (fallback).**

| Rule | Candidate | Outcome |
|---|---|---|
| 1 | [Issue 772](https://github.com/marinoscar/EnterpriseAppBase/issues/772), support bundle (PR 820) | Merged 2026-10-07 02:13, **before** issue 719 closed (09:55). Not eligible. |
| 2 | [Issue 773](https://github.com/marinoscar/EnterpriseAppBase/issues/773), air-gap check (PR 813) | Merged 00:47, before issue 719 closed. Not eligible. |
| 3 | Any merged PR after 09:55 that changes a packaged slice with a changeset | None: the last merged PR is 827 (07:55, docs). |
| 4 | Fallback: make `METRIC_FRESH_MS` a `TelemetryModule.forRoot({ metrics: { freshMs } })` option, default 150 s, and show the window in the dashboard metrics header | **Applied.** |

**Deviation:** rule 4 waits for "10 working days" after issue 719 closes. The program ran compressed (PP-10.1 to PP-10.4 in about 12 hours), so waiting would have stalled the gate without producing a better candidate. The wait was waived for this run under the owner's delegated authority, and the deviation is recorded here.

**The change.** On the PR branch for issue 720, commits `175ddd31` (api + contract), `77336537` (web), `ab62a811` and the shape-test fix (reference-app tests), and `183e3693` (telemetry spec):

- **Contract layer** (`@marinoscar/platform-contract/telemetry`): the `/metrics` response gains an optional `freshMs`.
- **API layer** (`@marinoscar/platform-api/telemetry`): the `metrics.freshMs` option, validated at boot (whole milliseconds, 1 s to 24 h), bound to a new `TELEMETRY_METRIC_FRESH_MS` token and threaded through `computeMetricGroup` and `buildTable`. `METRIC_FRESH_MS` (150 000) stays the default.
- **Web layer** (`@marinoscar/platform-web/telemetry/ui`): a section that has a table shows "Current within 2 min 30 s" in its header.
- A changeset (`minor` for api, contract and web), README catalog rows, and unit, module, contract, web and reference-app tests.

Base side: 18 files, about +326 / −15 lines, 5 commits. About 12 minutes of agent time from first edit to last commit, plus local verification.

It is additive and keeps the default, so a consumer that changes nothing keeps its behaviour. That makes it the cheapest possible case for the package route and a realistic one for the copy route: someone still has to port it to stay aligned with the base.

## 3. Metrics, both routes

EvoPath side only, unless stated.

**Package route** is a local rehearsal of the bump EvoPath would make for the next release. The branch's six packages were packed with `npm pack` and served at release-shaped URLs. EvoPath `origin/main` (`098cd769`) was re-pinned to them, installed, typechecked and tested. Nothing was pushed. Its lead time comes from the real cycle in [section 5](#5-real-pipeline-calibration-the-derivesigningkey-seam-cycle).

**Copy route** is the same base diff, path-translated and applied with `git apply` to a throwaway branch `spike/pp-10-5-copy-port`. The branch was cut from EvoPath's rollback SHA `144b4205`, because the `MonoRepo` tag itself is not pushed yet (an owner step). It ran in a scratch clone, was never pushed, and was deleted after measurement.

| Id | Metric | Package route | Copy route |
|---|---|---|---|
| M1 | Files touched, excluding `package-lock.json` | **6**: 4 `package.json` (root, api, web, cli), 1 app test, the ledger | **11**: 7 production files (api 4, web 2, docs 1) and 4 test files |
| M2 | Lines changed, excluding the lockfile | **15** (+9 / −6). The lockfile adds +15 / −15. | **150** (+141 / −9) |
| M3 | Hands-on time | Agent: 8.9 min measured, of which about 4.4 min went on a rehearsal-only install artefact and an accidental full web run; **about 4.5 min** on a clean path. Owner: no estimate given; reviewer estimate **about 5 min** for a pin bump. | Agent: **5.4 min**, done by the change's author minutes after writing it, with a scripted path map (a lower bound). Owner: no estimate given; reviewer estimate **about 20 min** for 150 lines in 11 files. |
| M4 | Lead time, base PR merged → EvoPath `main` green | Not measurable yet: the change is not merged. Real calibration, seam 822: **6 h 12 min** to `next`. The `latest` promotion is impossible today. | **5.4 min** to green on the telemetry subset; about 36 min including the full api and web suites ([Appendix A.6](#a6-full-suites)). |
| M5 | Hunks that did not apply, plus manual fixes | **0** conflicts; **1** manual fix (the app's shape test). The rehearsal also showed one install trap ([section 8](#8-friction-log), item 8). | 40 hunks in 12 translated files: 12 applied, **15 rejected**, **13 with no target file** (`telemetry.options.ts`, its spec, `index.ts`). `--3way` applied nothing (the base blobs are absent). Plus **11 path remaps**, and **4 manual fixes**: the web response type (hand-written in the copy, inferred from the contract in the package), the shape test, the doc wording (no `forRoot` in the copy), and a test constructor. |
| M6 | CI runs to green | Local only: 2 test runs (the first failed only on the shape test). Real calibration, PR 353: 3 PR runs (one red visual job, then two runs that never started a job), then green on `main`. | Local only: 2 test runs (the first failed only on the shape test). Never pushed, by design. |
| M7 | Platform files edited in EvoPath | **0** | **11** (= M1) |
| M8 | Pipeline incidents needing a manual workaround | 7 across issues 717 to 720 ([section 8](#8-friction-log)); 1 more in this rehearsal | n/a (no pipeline) |

Verification on both routes: `tsc --noEmit` for api and web (and cli on the package route) passes. The telemetry tests pass after the one shape-test fix. On the package route: api 113 and web 371. On the copy route: api 1 302 run (the 6 shape-test failures fixed and re-run green) and web 234. The full api and web suites are recorded in [Appendix A](#a6-full-suites).

## 4. The decision rule, evaluated

| Condition | Threshold | Measured | Holds? |
|---|---|---|---|
| H1 | M7 = 0 on the package route | 0 | **Yes** |
| H2 | EvoPath CI green on `next` (the `platform-next.yml` run) and on the released version, without a workaround | `platform-next.yml`: **0 runs**. It installs from npm and nothing is on npm. Every `next.N` reached EvoPath through GitHub-release URL pins, the interim channel. No `latest` release exists. Adoption PR CI was green for PRs 348, 350 and 351. PR 353 merged although its final head's CI never started a job; `main` was green 5 min after the merge. | **No** |
| H3 | No production incident or data change caused by the packaged slices during issues 717 to 719 | No production deploy ran in EvoPath in the window (`deploy.yml`: 0 runs). No migration. The only schema change is comment-only (cipher paths in `schema.prisma`). | **Yes** (nothing reached production) |
| E1 | M1 (package) ≤ 3 **and** ≤ 25% of M1 (copy) | 6, and 6 / 11 = 55% | **No** |
| E2 | M3 (package) ≤ 50% of M3 (copy) | Agent minutes only: 4.5 / 5.4 = 83% (8.9 / 5.4 = 165% as measured). With the reviewer's estimates: 9.5 / 25.4 = 37%. The owner has not given review minutes. | **Not established**, counted as **No** |
| E3 | M4 (package) ≤ 2 working days, including the `next` → `latest` promotion | `next`: 6 h 12 min (seam 822 cycle). `latest`: impossible while in pre-release mode without npm. | **No** (as written) |

**Verdict:** H2 fails, and fewer than two of E1 to E3 hold, so **NO-GO**.

**Owner override:** none recorded. To override, the owner comments on issue 720 with a reason, and this section records it next to the computed verdict.

## 5. Real-pipeline calibration: the deriveSigningKey seam cycle

The one platform change that has already gone end to end through the real interim pipeline is [seam request 822](https://github.com/marinoscar/EnterpriseAppBase/issues/822). EvoPath needed `deriveSigningKey` from `@marinoscar/platform-api/core` to delete its last local exception.

| Step | When (UTC, 2026-10-07) | Evidence |
|---|---|---|
| Seam request filed | 03:33:02 | issue 822 |
| Base PR opened | 03:42:40 | PR 823: 10 files, +209 / −4, 3 commits |
| Base PR merged | 03:48:22 | PR 823 (issue closed 03:48:23) |
| Version PR merged, together with PRs 824 and 825 | 06:53:59 | PR 826 (`0.1.0-next.3`, 17 files) |
| GitHub release published, automatically | 06:57:25 | `platform-v0.1.0-next.3`, 6 tarballs |
| EvoPath bump commit | 07:00:48 | `c6470fe3`: 3 files, 3 lines (later releases add `apps/cli`, so 4) |
| EvoPath shim removed | 07:01:30 | `fae9f716`: 4 files, +15 / −82, plus `3c4dd16d` (identity-guard comment, 1 file) |
| EvoPath PR merged | 09:55:39 | evopath PR 353 (rode with the 249-file telemetry adoption) |
| EvoPath `main` CI green | 10:00:06 | `CI` run on `098cd769` |

- **Lead time:** base merge → EvoPath `main` green: **6 h 12 min**, of which 3 h 09 min waited for the release to batch PRs 824 to 826, and about 3 h was the telemetry adoption itself. On its own, the seam needed about 15 minutes in the base and about 1 minute in EvoPath.
- **CI minutes:** PR 823: 20.7 min over 6 runs. PR 826: 25.8 min over 7 runs.
- **Human steps:** none by the owner. The orchestrating session opened and merged every PR, including the Version Packages PR, which Actions cannot open yet.
- **What it shows:** a seam request is a cost that exists only on the package route. Here it was cheap.

## 6. Projection to three apps (estimate)

**These are estimates, not measurements.**

- **Package route:** each further app pays about one bump PR, with no code.
- **Copy route:** EvoPath's M3 is scaled by each app's identical-file ratio from the spec's [Measured drift](../specs/platform-packages.md#measured-drift) table (API: EvoPath 78%, kvox 29%, MemoriaHub 5%).

| App | Package route (per platform change) | Copy route (this change) | Copy route (a change in a slice all three have, for example storage) |
|---|---|---|---|
| EvoPath | Measured: 6 files, 15 lines, about 5 min agent + about 5 min review, same day on `next` | Measured: 11 files, 150 lines, 5.4 min agent (lower bound) + about 20 min review | Baseline: 1× |
| kvox | About one bump PR once it has adopted the slice: about 10 min, 0 code files | **Not portable by copy**: kvox has no telemetry slice; the whole 92-file API slice and the web pages would have to come first | About 78 / 29 = **2.7×** EvoPath's copy cost |
| MemoriaHub | Same as kvox | **Not portable by copy**: no telemetry slice | About 78 / 5 = **15.6×** EvoPath's copy cost |
| Three apps | About 3 × 10 min, 0 code files | EvoPath only; 2 of 3 apps cannot receive it | About 1 + 2.7 + 15.6 ≈ **19×** EvoPath's copy cost |

## 7. How much platform code left EvoPath

The drift report (`scripts/platform-drift.mjs`) was re-run on EvoPath `origin/main` (`098cd769`, after PR 353). It uses the same base the PP-10.1 baseline used (`d58ca18e`, before any extraction), so the files that left EvoPath show up as "base-only".

| Area | MonoRepo (`144b4205`): identical + normalised | Now: identical + normalised | Base files now absent from EvoPath |
|---|---|---|---|
| API (`apps/api/src`, 984 base files) | 796 (**80.9%**; 704 byte-identical) | 626 (63.6%) | 67 → **185** (+118: telemetry 92, common 17, doctor 9) |
| API tests (141) | 113 (80.1%) | 109 (77.3%) | 10 → 10 |
| Web (`apps/web/src`, 514) | 405 (78.8%) | 325 (63.2%) | 12 → **90** (+78, including `components/telemetry` 36, 24 test files, and the telemetry and Doctor pages, hooks and services) |
| CLI (233) | 185 (79.4%) | 179 (76.8%) | 12 → 13 |

- **118 API and 78 web platform files** are gone from EvoPath. They are replaced by about 18 binding files (`apps/api/src/platform/` 12, `app-metrics/` 4, `apps/web/src/platform/` 2).
- The PP-10.1 figures are reproduced exactly from the MonoRepo SHA: API 80.9%, and 704 + 92 files. The older spec figure "78% (721)" came from the cruder `cmp` method.
- The real divergence that remains is about the same: API +4 276 / −2 289 lines against +4 227 / −1 892. The lines removed with the copies were identical lines, and the binding files added a few.

## 8. Friction log

From the completion comments of issues [716](https://github.com/marinoscar/EnterpriseAppBase/issues/716), [717](https://github.com/marinoscar/EnterpriseAppBase/issues/717), [718](https://github.com/marinoscar/EnterpriseAppBase/issues/718), [719](https://github.com/marinoscar/EnterpriseAppBase/issues/719) and [822](https://github.com/marinoscar/EnterpriseAppBase/issues/822), the EvoPath adoption PRs (348, 350, 351, 353), the base history and this run.

| EvoPath PR | Story | Package version | Elapsed (first commit → merge) | Files (+/−) | Seam requests | Workarounds |
|---|---|---|---|---|---|---|
| [348](https://github.com/marinoscar/evopath/pull/348) | PP-10.1 prepare | n/a | 17 min | 12 (+8 392 / −0) | none | The rollback tag stays an owner step (not pushed yet); docs say "the app" because of the identity guard |
| [350](https://github.com/marinoscar/evopath/pull/350) | PP-10.2 Doctor | `0.1.0-next.1` | 68 min | 87 (+838 / −2 215) | none | URL pins (no npm), so Renovate cannot upgrade them |
| [351](https://github.com/marinoscar/evopath/pull/351) | PP-10.3 core, otel-core | `0.1.0-next.2` | 89 min | 183 (+3 168 / −4 692) | 822 | `deriveSigningKey` shim kept as a local exception; contract pinned at the root with an `overrides` `$` reference; `domain-*` file names because of the identity guard |
| [353](https://github.com/marinoscar/evopath/pull/353) | PP-10.4 telemetry | `0.1.0-next.3` | 175 min | 249 (+2 794 / −42 038) | 1 follow-up (live-GreptimeDB test helpers) | Visual baselines regenerated; merged although its final head's CI never started |

**Pipeline incidents (M8)** that needed a manual workaround:

1. **npm is not enabled** (owner prerequisite). The six packages ship as GitHub-release tarballs, and apps pin URLs. Renovate cannot compare URL pins, so every bump is a hand edit of 6 URLs in 4 `package.json` files (exact-pin version churn).
2. **`@marinoscar/platform-contract` is not on npm**, and api and web depend on it. EvoPath pins it at the root and points every copy at that pin through an `overrides` entry (`"$@marinoscar/platform-contract"`).
3. **Actions cannot open the Version Packages PR** (owner setting). The version PRs 812, 819 and 826 were opened and merged by the orchestrating session instead.
4. **`platform-next.yml` can never run**: it installs a dist-tag from npm. 0 runs.
5. **The `MonoRepo` tag is not pushed in EvoPath** (owner step). The copy route used the recorded SHA `144b4205`.
6. **PR 353 merged without a check on its final head.** The visual-baselines workflow pushed that commit with `GITHUB_TOKEN`, and the resulting runs never started a job (closed as failed at merge). `main` was green afterwards.
7. **`0.1.0-next.0` never got a GitHub release**, and the runbook's release log still shows only that version.
8. (This run, rehearsal) **Re-pinning a tarball of the same version in place** makes `npm install` nest `platform-api` and `platform-web` under their workspaces instead of hoisting them. That breaks an app test that resolves `@marinoscar/platform-api` from `apps/web`, and a CodeMirror-based page test. Deleting the platform entries from the lockfile before `npm install` restores the hoisted layout (+15 / −15 lockfile lines). A real npm version bump (Renovate) does not hit this.

**Program-execution friction** (not a cost of one change, but real):

- **CI flake: cron timers in the shared integration test app.** Wall-clock `@Cron` ticks enqueued housekeeping jobs into other specs' spies, at random. Fixed in `264eb1d7` (stop every cron job after `app.init()`). 24 of 27 red base CI runs were on PR branches.
- **An unrelated EvoPath flake** (`useAiChat` stop timing, web shard 4/6) turned `main` red once after PR 350.
- **Rebase conflicts in shared index files**, appended to by many stories at once: slice `index.ts` exports, `docs/README.md`, the spec, `package-lock.json` (regenerated, never hand-merged).
- **Container restarts** killed in-flight sessions. Commit-every-30-minutes kept the loss small.
- **Scale of the run:** 50 merged base PRs (775 to 827), 407 non-merge commits and 323 CI, Packages, Release and E2E runs (about 991 CI minutes) since 2026-10-06; 3 releases.

## 9. Learnings

**Cheaper than expected.**
- Adopting a slice deletes far more than it adds: PR 353 removed 42 038 lines and added 2 794.
- A seam round trip (issue 822) took 15 minutes in the base and 1 minute in the app.
- The GitHub-release job is fully automatic once the version PR merges: about 3.5 minutes to six tarballs.
- The first real extension, the coach metric group, needed no platform edit.

**Costlier than expected.**
- Lockstep exact pins in **4 workspace manifests**: every bump touches 4 files even when no code changes, which alone breaks E1's "≤ 3".
- App-side tests copied from the reference app that **pin a platform response shape** with `toEqual`. EvoPath's `test/telemetry/telemetry-dashboard.integration.spec.ts` fails on any additive field, so an additive platform change still edits the app. The base's own reference-app copy of that test needed the same edit.
- The copy route was cheaper in agent minutes than the package route's first attempt, because the porter had just written the change. An independent porter would also have to re-design 13 hunks for a module shape the copy does not have.

**Seam requests filed or implied.**
- Issue 822 (done).
- Export live-GreptimeDB test helpers (follow-up of issue 719).
- New: move the `/metrics` shape assertion into the telemetry conformance suite (`runPlatformConformance({ suites: { telemetry } })`), so apps stop pinning platform shapes.

**Release-pipeline fixes needed.**
- npm trusted publishing, so Renovate and `platform-next.yml` work.
- Actions permission to open the Version Packages PR.
- A required green check on the final head before merging app PRs.
- A one-line runbook warning about the in-place re-pin trap while URL pins remain.

**Metric definitions to fix for the re-run.**
- E1 should count **code files** (or allow one manifest per workspace plus the ledger). Version pins and a ledger note are not porting work.
- E2 needs the owner's own review minutes. Without them, agent minutes on a small change are too close to call.
- E3's `latest` clause cannot be met while the program is deliberately in pre-release mode.

## 10. What must change before a re-run

A re-run repeats sections 3 and 4 with the same representative change, after it merges.

| # | Step | Who |
|---|---|---|
| 1 | Enable npm publishing: bootstrap the six names, attach the trusted publishers, set `NPM_PUBLISH_ENABLED` ([release runbook](../runbooks/release-platform-packages.md)) | Owner |
| 2 | Allow GitHub Actions to create PRs in EnterpriseAppBase (Version Packages PR) | Owner |
| 3 | Install Renovate on `marinoscar/evopath`; push EvoPath's `MonoRepo` tag at `144b4205` | Owner |
| 4 | Merge the representative change; release it on `next` | Orchestrator |
| 5 | Run `platform-next.yml` in EvoPath on that `next` (H2) | Orchestrator |
| 6 | Promote to `latest`, or amend E3 to "`next` while in pre-release mode" (an owner decision) | Owner |
| 7 | Let Renovate open the EvoPath bump PR; merge it with a green check on its final head (H2, M4, M6) | Orchestrator, owner merges |
| 8 | Give review and merge minutes for both routes (E2) | Owner |
| 9 | Optionally first: the conformance seam above, so the package route needs no app test edit (M1 5 → 4 + ledger) | Orchestrator |

If the owner accepts the code-level evidence instead, an override comment on issue 720 with a reason is enough, under the decision rule. This report then records the override next to the computed NO-GO.

## 11. Recommendation for issue 747 onwards

- **Do not start issue 665 or later** on this result. Keep everything merged (waves 0 to 3, the Prisma spike): it is worth having either way.
- **Fix the pipeline before the next slice**, not after. Steps 1 to 3 above are owner clicks, and they remove 5 of the 8 pipeline incidents.
- **Re-run the gate on the representative change** as soon as steps 1 to 7 are done. Expected result on the package route: 5 to 6 files (code 0), lead time under a day, and H2 met.
- **Hold issue 747 and the rest of the EvoPath track** with issue 665 and later: they all sit behind the gate. Once a re-run records GO, or the owner overrides, start with issue 747 (the database baseline). It needs no new package, rehearses on a restored backup first, and is the riskiest step left, so it deserves the most lead time.
- **On the re-run, measure the bump through Renovate** (not by hand), and give the owner's own review minutes, so E2 and E3 are measured rather than estimated.

## Appendix A: raw commands and outputs

Local scratch paths are shortened to `SCRATCH/`.

### A.1 Selection: what merged when

```text
$ gh api repos/marinoscar/EnterpriseAppBase/issues/{719,772,773,822} --jq '"\(.number) \(.state) \(.closed_at)"'
719 closed 2026-10-07T09:55:42Z
772 closed 2026-10-07T02:13:50Z
773 closed 2026-10-07T00:47:02Z
822 closed 2026-10-07T03:48:23Z
$ gh api 'repos/marinoscar/EnterpriseAppBase/pulls?state=closed&per_page=100' --jq '.[]|select(.merged_at!=null)|"\(.number) \(.merged_at)"' | sort -n | tail -3
825 2026-10-07T04:51:51Z
826 2026-10-07T06:53:59Z
827 2026-10-07T07:55:15Z
```

### A.2 The base change

```text
$ git diff --stat 73b3cf82..183e3693
 .changeset/telemetry-metric-fresh-window.md        |  7 +++
 .../telemetry-extension-points.integration.spec.ts | 42 +++++++++++++-
 docs/specs/telemetry.md                            |  6 +-
 packages/platform-api/src/telemetry/README.md      |  8 ++-
 .../dashboard/telemetry-dashboard.service.spec.ts  | 17 ++++++
 .../dashboard/telemetry-dashboard.service.ts       | 12 ++--
 packages/platform-api/src/telemetry/index.ts       |  4 ++
 .../src/telemetry/metrics/metric-group.spec.ts     | 21 +++++++
 .../src/telemetry/metrics/metric-group.ts          | 23 ++++++--
 .../platform-api/src/telemetry/telemetry.module.ts |  4 ++
 .../src/telemetry/telemetry.options.spec.ts        | 35 +++++++++++-
 .../src/telemetry/telemetry.options.ts             | 66 ++++++++++++++++++++++
 .../test/telemetry/telemetry.module.spec.ts        |  3 +
 .../platform-contract/src/telemetry/dashboard.ts   | 12 +++-
 packages/platform-contract/test/telemetry.test.ts  | 21 +++++++
 .../dashboard/metrics/MetricSections.tsx           | 34 +++++++++++
 .../dashboard/metrics/MetricSections.test.tsx      | 25 ++++++++
 17 files changed, 325 insertions(+), 15 deletions(-)
```

Plus the next commit: `apps/api/test/telemetry/telemetry-dashboard.integration.spec.ts`, +1 (`freshMs: 150_000` in the shape test).

### A.3 Package route (rehearsal on EvoPath `origin/main` `098cd769`)

```text
$ for p in contract api web db cli infra; do npm pack -w "@marinoscar/platform-$p" --pack-destination SCRATCH/tarballs; done
$ git -C ~/evopath archive origin/main | tar -x -C SCRATCH/evo-pkg     # then sed the 6 release URLs to the served tarballs
$ npm install --no-audit --no-fund --ignore-scripts                     # after deleting the platform entries from the lockfile (see section 8, item 8)
added 5 packages, and changed 1 package in 6s
$ npm run typecheck --workspace=api && npm run typecheck --workspace=web && npm run typecheck --workspace=cli
api=0 web=0 cli=0
$ npx jest --config ./test/jest.config.js test/telemetry src/platform --maxWorkers=2     # apps/api, first run
Tests:       6 failed, 107 passed, 113 total          # "group <id> answers the documented shape": unexpected freshMs
$ # one line added to the shape test: freshMs: 150_000
Tests:       113 passed, 113 total
$ npx vitest run src/__tests__/platform src/__tests__/theme/telemetryTokens.test.tsx src/__tests__/pages/Admin/Telemetry*.test.tsx src/__tests__/config --maxWorkers=2
 Test Files  12 passed (12)
      Tests  371 passed (371)
$ npx vitest run --maxWorkers=2      # apps/cli
 Test Files  125 passed (125)
      Tests  2248 passed (2248)
$ git diff --stat HEAD -- . ':!package-lock.json'
 apps/api/package.json                                           | 4 ++--
 apps/api/test/telemetry/telemetry-dashboard.integration.spec.ts | 1 +
 apps/cli/package.json                                           | 4 ++--
 apps/web/package.json                                           | 2 +-
 docs/platform-adoption/README.md                                | 2 ++
 package.json                                                    | 2 +-
 6 files changed, 9 insertions(+), 6 deletions(-)
$ git diff --stat HEAD -- package-lock.json
 package-lock.json | 30 +++++++++++++++---------------
```

### A.4 Copy route (throwaway `spike/pp-10-5-copy-port` from `144b4205`, never pushed)

```text
$ git clone --no-checkout ~/evopath SCRATCH/evo-copy && git switch -c spike/pp-10-5-copy-port 144b42057f91246ccf3af223f628c43ad9ec3768
$ # path map: packages/platform-api/src/telemetry/ -> apps/api/src/telemetry/;
$ #   packages/platform-contract/src/telemetry/dashboard.ts -> apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts;
$ #   packages/platform-web/src/telemetry/ui/components/ -> apps/web/src/components/telemetry/;
$ #   packages/platform-web/test/telemetry/ -> apps/web/src/__tests__/components/telemetry/
$ #   no target: .changeset, package README, platform-api module spec, contract test, reference-app extension-points spec
$ git apply --3way --reject copy-port.patch
error: options '--reject' and '--3way' cannot be used together
$ git apply --3way copy-port.patch
error: repository lacks the necessary blob to perform 3-way merge.   (x9; nothing applied)
error: apps/api/src/telemetry/index.ts: does not exist in index
error: apps/api/src/telemetry/telemetry.options.ts: does not exist in index
$ git apply --reject --verbose copy-port.patch
Applied patch docs/specs/telemetry.md cleanly.
Applied patch apps/api/src/telemetry/dashboard/telemetry-dashboard.service.spec.ts cleanly.
Applying patch apps/api/src/telemetry/dashboard/telemetry-dashboard.service.ts with 4 rejects...
Applied patch apps/api/src/telemetry/metrics/metric-group.spec.ts cleanly.
Applying patch apps/api/src/telemetry/metrics/metric-group.ts with 2 rejects...
Applying patch apps/api/src/telemetry/telemetry.module.ts with 3 rejects...
Applying patch apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts with 2 rejects...
Applying patch apps/web/src/components/telemetry/dashboard/metrics/MetricSections.tsx with 2 rejects...
Applying patch apps/web/src/__tests__/components/telemetry/dashboard/metrics/MetricSections.test.tsx with 2 rejects...
error: apps/api/src/telemetry/index.ts: No such file or directory
error: apps/api/src/telemetry/telemetry.options.spec.ts: No such file or directory
error: apps/api/src/telemetry/telemetry.options.ts: No such file or directory
$ # hand port: token TELEMETRY_METRIC_FRESH_MS in metric-group.ts, bound in the static TelemetryModule;
$ #   freshMs on the DTO and on the web's hand-written DashboardMetrics type; header note; tests adapted
$ npm ci && npm run typecheck --workspace=api && npm run typecheck --workspace=web
api=0 web=0
$ npx jest --config ./test/jest.config.js src/telemetry test/telemetry --maxWorkers=2     # apps/api, first run
Tests:       6 failed, 35 skipped, 1261 passed, 1302 total      # the same shape test
$ # one line added to the shape test
Tests:       59 passed, 59 total                                 # test/telemetry/telemetry-dashboard.integration.spec.ts
$ npx vitest run src/__tests__/components/telemetry --maxWorkers=2
 Test Files  17 passed (17)
      Tests  234 passed (234)
$ git diff --cached --stat 144b42057f91246ccf3af223f628c43ad9ec3768 -- . ':!package-lock.json'
 .../dashboard/telemetry-dashboard.service.spec.ts  | 15 ++++++++++
 .../dashboard/telemetry-dashboard.service.ts       | 10 +++++--
 .../src/telemetry/dto/telemetry-dashboard.dto.ts   |  9 ++++++
 .../api/src/telemetry/metrics/metric-group.spec.ts | 21 +++++++++++++
 apps/api/src/telemetry/metrics/metric-group.ts     | 24 +++++++++++----
 apps/api/src/telemetry/telemetry.module.ts         |  3 ++
 .../telemetry-dashboard.integration.spec.ts        |  1 +
 .../dashboard/metrics/MetricSections.test.tsx      | 25 ++++++++++++++++
 .../telemetry/dashboard/metrics/MetricSections.tsx | 34 ++++++++++++++++++++++
 apps/web/src/services/telemetryDashboard.ts        |  2 ++
 docs/specs/telemetry.md                            |  6 +++-
 11 files changed, 141 insertions(+), 9 deletions(-)
$ git branch -D spike/pp-10-5-copy-port && rm -rf SCRATCH/evo-copy      # never pushed; no copy-route commit exists on EvoPath main
```

### A.5 Timestamps (hands-on time, M3)

```text
base change      start 10:00:59Z   committed 10:08:22Z   (+ shape-test fix found by the copy route, 10:14Z)
copy route       start 10:09:14Z   green (telemetry subset) 10:14:40Z
package route    start 10:14:40Z   green (telemetry subset) 10:23:34Z   (10:17-10:21 lost to the in-place re-pin trap)
```

### A.6 Full suites

Run after the routes were green on the telemetry subset, with `--maxWorkers=2`, unit and mocked-integration tiers (`.db.spec` and `.greptime.spec` excluded, as in the api `test` script). Wall time is machine time on a shared 4-CPU host.

| Route | API (`jest`) | Web (`vitest run`) | Wall time |
|---|---|---|---|
| Package (rehearsal) | 670 suites passed (4 skipped), **15 723 tests passed**, 0 failed | 400 files, **6 176 tests passed** (3 skipped), 0 failed | api 7.8 min, web 24.4 min |
| Copy (throwaway) | 699 suites passed (4 skipped), **16 977 tests passed**, 0 failed | 420 files, **6 418 tests passed** (3 skipped), 0 failed | api 7.6 min, web 22.7 min |

The copy route runs more tests because its local telemetry copy still carries the slice's own unit tests. On the package route those tests run in the platform repository instead.

### A.7 CI and pipeline evidence

```text
$ gh api repos/marinoscar/evopath/actions/workflows/platform-next.yml/runs --jq .total_count
0
$ gh api repos/marinoscar/evopath/actions/workflows/deploy.yml/runs --jq .total_count
0
$ gh api repos/marinoscar/EnterpriseAppBase/releases --jq '.[]|"\(.tag_name) \(.published_at) prerelease=\(.prerelease)"'
platform-v0.1.0-next.3 2026-10-07T06:57:25Z prerelease=true
platform-v0.1.0-next.2 2026-10-07T02:05:19Z prerelease=true
platform-v0.1.0-next.1 2026-10-07T00:44:52Z prerelease=true
$ # EvoPath PR 353 runs (head sha, workflow, conclusion)
eef2342e  CI          failure   (Visual regression only; baselines then regenerated)
8d2e3ec2  CI          failure   (0 jobs; never started; closed at merge)
8d2e3ec2  Deploy E2E  failure   (0 jobs)
098cd769  CI          success   (main, 10:00:06Z)
$ # EvoPath main after PR 350
3e3a0565  CI          failure   (Web Tests 4/6: useAiChat stop() timing, unrelated to the platform)
```

### A.8 Drift re-run

```text
$ node scripts/platform-drift.mjs --app SCRATCH/evo-mono --base SCRATCH/base-d58 --out SCRATCH/drift-mono-vs-d58
| api | `apps/api/src` | 984 | 704 | 92 | 121 | 67 | 830 | +4227 / -1892 | 80.9% |
| web | `apps/web/src` | 514 | 347 | 58 | 97 | 12 | 621 | +3562 / -938 | 78.8% |
$ node scripts/platform-drift.mjs --app SCRATCH/evo-main --base SCRATCH/base-d58 --out SCRATCH/drift-main-vs-d58
| api | `apps/api/src` | 984 | 572 | 54 | 173 | 185 | 853 | +4276 / -2289 | 63.6% |
| web | `apps/web/src` | 514 | 300 | 25 | 99 | 90 | 627 | +3771 / -1107 | 63.2% |
$ # migrations, MonoRepo vs d58ca18e: shared 20, renamed 1, sameNameDifferentSql 0
$ for m in shared migrations; do cmp base/$m evo/$m; done      # 19 byte-identical, 1 differs:
DIFF 20260930120000_add_job_trace_context
< -- Issue #607: carry the enqueuing request's W3C trace context on the job row.
> -- Issue #132: carry the enqueuing request's W3C trace context on the job row.
```

No metric collection read user data. Every number above comes from git, GitHub metadata, CI metadata and test output.
