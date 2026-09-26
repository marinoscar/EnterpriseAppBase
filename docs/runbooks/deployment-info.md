# Runbook: the About page's deployment sections

**Audience:** whoever operates a deployment of this application and wants to
answer, from inside the running app, "what is actually deployed here?" — a
question that is often asked precisely when SSH access is inconvenient or
unavailable.
**Applies to:** the deployment sections of the **About** page
(`/admin/settings/about`), the `GET /api/admin/about` endpoint behind it, and
`deploy-info/info.json`, the document `appctl deploy` leaves for the running
application to read.

This is the operator-facing companion to
[`docs/specs/vps-deploy.md`](../specs/vps-deploy.md) §19.4, which records the
design decision this page rests on (why an existing page was extended rather
than a new one built) and to
[`docs/deployment/vps.md`](../deployment/vps.md), the install/update runbook.
Read those for *why*; this one is about what the page shows, why it can
legitimately say "not configured," and how to point it at a different file.

Source of truth for every claim below:

- `apps/api/src/about/about.controller.ts` / `about.service.ts` — the single
  `GET /api/admin/about` route and what it assembles.
- `apps/api/src/about/deploy-info.ts` — reads and validates the document.
- `apps/api/src/about/dto/about-response.dto.ts` — the full response shape,
  and the argument for why the endpoint always answers `200`.
- `apps/web/src/pages/Admin/AboutPage.tsx` — the page itself.
- `apps/cli/src/deploy/deploy-info.ts` — builds and atomically writes the
  document.
- `apps/cli/src/deploy/state.ts` — `DeployState` v2, `HostFacts`,
  `DeploymentHistoryEntry`, `DeployProxyFacts` — the CLI-side types the
  document's new fields mirror.
- `infra/compose/vps.compose.yml` — the bind mount that carries the document
  into the API container.

---

## 1. What the page shows

**About is one page, not two.** Issue #392 originally asked for a separate
"Deployment" admin page; it was delivered instead as more sections on the
existing About page, behind the existing endpoint and permission —
`/admin/settings/deployment` is a redirect to `/admin/settings/about`, not a
second destination. See §19.4 of the spec for the reasoning; the short
version is that both were already answering the same question ("what is
running here?") from the same document, and a second card for the same
question is exactly the drift the Settings UI Pattern exists to prevent.

The page renders, in order:

- **This deployment** — application name, version, commit, ref, domain, the
  last command run (`install`/`update`), bind port, proxy mode and container,
  certificate expiry, when it was installed, when it was last updated, who
  deployed it (`appctl` and its version), and the exact path the record was
  read from.
- **Deploy run** — which steps completed, and, for a run that failed
  partway, which step it stopped at (see §3 below).
- **Against the remote** — whatever the document recorded about the tracked
  remote (deliberately `null` today; see the field's own comment in
  `deploy-info.ts` — this CLI does not ask the remote how far ahead it is at
  deploy time, and reporting a fabricated "0 commits behind" would be a claim
  this CLI cannot back up).
- **Host** — hostname, OS, kernel, architecture, CPU count, memory, Docker
  and Compose versions, as observed **at deploy time**, not live.
- **This API process** — `processStartedAt`, the Node version, and
  `NODE_ENV`, describing the process answering the request **right now**.
  This is the one live section; everything above it is a snapshot from the
  last successful deploy.
- **Database** — a liveness fact (`up`/`down` plus response time), or an
  error string when the probe fails. This never blocks the rest of the page:
  the API version, the commit SHA and the deploy document are all knowable
  with no database at all, so a database outage degrades this one section,
  not the whole page.
- **Deployment history** — a table (a stacked list on a phone) of the last
  20 successful `install`/`update` runs, newest first: timestamp, command,
  commit, previous commit, ref, duration, `appctl` version.

Nothing on this page polls. A deployment's identity changes when somebody
deploys, not on a timer, so the page instead exposes an explicit **Refresh**
button — the API re-reads the document from disk on every request, so that
button picks up a deploy that just finished with no restart and no page
reload.

## 2. Why it can legitimately read "not configured" / absent

**There is deliberately no sentence on this page meaning "this instance was
not deployed with `appctl`."** That would be a claim about the world, and it
is false in at least three ordinary situations:

- `DEPLOY_INFO_PATH` points somewhere the file is not.
- The bind mount carrying the directory into the API container never
  attached (a fresh checkout with no `DEPLOY_ROOT` set, for instance — see
  §4 below).
- A deploy run stopped before it got as far as writing the document (see §3).

In every one of those, a deployment may very well have been made with the
CLI — telling the operator otherwise would send them off to "fix" something
that already works. So the page says only what is actually true: **no
deployment record was found at the path the API looked at**, and it shows
that path (`deployInfoPath` in the API response, "Record read from" on the
page) — the one fact that actually distinguishes the three situations above
from one another, and from a plain local or `dev`/`prod` (non-VPS)
deployment that was never expected to have this document at all.

A malformed or unreadable document is reported distinctly, as `invalid`, from
a genuinely absent one — a corrupt file is not the same problem as a missing
deployment, and conflating the two would send an operator investigating the
wrong thing.

## 3. Three states, and the one that gets forgotten

The endpoint's `deployInfoStatus` plus `run.outcome` together describe three
states, not two:

1. **`ok`, `run.outcome !== 'failure'`** — a document, and the run it
   describes finished. The ordinary case.
2. **`absent` / `invalid`** — no usable document. The page still renders
   everything it *does* know (the API's own version, the database liveness)
   and says plainly what it looked at and did not find.
3. **`ok`, `run.outcome === 'failure'`** — a *complete* document describing a
   run that failed partway. This is not a variant of state 2, and the page
   does not collapse it into one: a run that got far enough to write this
   document really did deploy something — there is a real commit on the
   machine, the steps in `run.completed` genuinely ran — and
   `run.failedStep` names the one that did not finish. Every fact renders
   exactly as in state 1, with an *additional* warning naming the failed
   step; the facts are never hidden behind the warning.

## 4. How the data gets there

**The document is `deploy-info/info.json`, inside the deployment root,
written by the CLI, not by the application.** Two writes, at two different
moments in the pipeline, using the same builder
(`apps/cli/src/deploy/deploy-info.ts`'s `buildDeployInfo`/`writeDeployInfo`),
so the two can never drift in shape:

1. **At the health gate**, once `/api/health/ready` first answers. If the
   API is answering, the application demonstrably *is* deployed, and the
   document should say so — writing only at the very end of the pipeline
   would mean a failure between the health check and the end (a bad vhost,
   a failed certificate) left the About page reporting nothing at all about
   a deployment that is up and serving, which is exactly the moment someone
   is likely to be looking at it. This first write cannot yet carry this
   run's history entry (history is success-only, and the run has not
   succeeded yet) or the certificate `publish` has yet to issue.
2. **At the end of a successful run**, adding exactly what the run learned
   since the health-gate write: the history entry, the resolved proxy facts,
   host facts. A run that fails *after* the health gate leaves the first
   write standing — which is precisely state 3 above, "complete, but did not
   finish."

**The write is atomic, and the *directory* is what is bind-mounted, not the
file.** `writeDeployInfo` writes a temp file and renames it over
`info.json`; `vps.compose.yml` mounts the `deploy-info/` directory read-only
into the API container, so a redeploy replaces the file the container reads
with no restart. Bind-mounting the file itself would pin an inode and leave
the container reading the old document forever, since a rename does not
change what an already-open file descriptor points at.

**The reader treats the document as untrusted input.** It is a file on disk
the API did not write and cannot fully control the shape of (an operator
could, in principle, hand-edit it, or an older/newer CLI version could write
slightly different fields). `schema` is validated **strictly** — it must be
exactly `1` — and everything else **leniently**: an invalid sub-field
becomes `null` rather than failing the whole read, and an invalid history
entry is dropped rather than discarding the rest of the list, capped to 20
either way. `schema` staying at `1` forever, with every addition since
(`lastCommand`, `bindPort`, `proxy`, `host`, `history`) arriving as an
**additive, optional** field, is deliberate: bumping the schema to add a
field would make every already-deployed API answer `invalid` the instant a
newer CLI wrote its file — before the container it describes had
necessarily restarted. No secret is ever written into this document; there
is nothing in it to redact.

**One field is never read from disk.** `runtime`
(`processStartedAt`/`nodeVersion`/`environment`) is assembled by the API
itself, live, on every request — it describes the process answering the
request right now, not a fact the CLI observed at deploy time. It is never
conflated with the document's own `host`/`proxy` facts: those describe what
the *server* looked like when it was last deployed; `runtime` describes what
the *process* looks like this instant.

## 5. Re-pointing the mount

The bind mount lives in `infra/compose/vps.compose.yml`:

```yaml
volumes:
  - ${DEPLOY_ROOT:-./.deploy}/deploy-info:/app/deploy-info:ro
environment:
  - DEPLOY_INFO_PATH=${DEPLOY_INFO_PATH:-/app/deploy-info/info.json}
```

`DEPLOY_ROOT` is written into `.env` by the CLI itself and is deliberately
**absent from `.env.example`** — it doubles as the marker the CLI uses to
recognise an `.env` it wrote (see `deployment-evidence.ts`), so it must never
appear there as a documented, user-set variable. The `${DEPLOY_ROOT:-./.deploy}`
default is what keeps `docker compose config` valid in a plain checkout that
was never deployed by `appctl` at all — the path simply does not exist, the
mount is empty, and the API correctly reports the document as absent, per §2
above.

To point a running deployment at a document somewhere else — moving the
deploy root, mounting from a different volume, or serving this compose file
against a deploy root management moved by hand — there are two independent
knobs, and you only need the second if you also changed the *filename*
inside the mounted directory:

1. **`DEPLOY_ROOT`** in the deployment's `.env` — changes *where on the
   host* `deploy-info/` is read from. This is what the CLI itself sets at
   install time; changing it by hand means also moving the actual
   `deploy-info/` directory there yourself, since nothing else does that
   move for you.
2. **`DEPLOY_INFO_PATH`** — changes the path *inside the container* the API
   reads, which only matters if you also changed
   `infra/compose/vps.compose.yml`'s mount target away from the default
   `/app/deploy-info/info.json`. Leave it alone unless you changed the
   mount target to match.

After changing either, `docker compose up -d` (from `infra/compose`, with
the same `-f base.compose.yml -f prod.compose.yml -f vps.compose.yml`
layering the deployment already runs under) to apply the new mount — this
needs a container recreation, unlike a redeploy of the document itself,
which needs nothing at all.

**The directory must exist before the stack starts, and must be writable by
whichever account runs `appctl`.** Docker creates a missing bind-mount
source as `root:root`, after which the CLI's own write fails with `EACCES`
— silently, with every deploy step still reporting green, because writing
this document is not itself a step whose failure stops the pipeline. The
install pipeline creates the directory ahead of the stack's first `up`
specifically to avoid this; if you have moved `DEPLOY_ROOT` by hand, create
`<new-root>/deploy-info/` yourself, owned by the same account, before
bringing the stack up.
