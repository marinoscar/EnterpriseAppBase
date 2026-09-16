# Runbook: The Deployment Info Page

This runbook covers `/admin/settings/deployment` — the admin page that
answers, without an SSH session, "what is actually running here, since when,
and from which commit?" It is the operator-facing companion to
[`docs/specs/vps-deploy.md`](../specs/vps-deploy.md) §18.6, which covers the
state file's shape and the mechanism underneath this page in full; this
document covers what you see, why it can legitimately say "not configured,"
and how to fix that when it shouldn't.

Source of truth for every claim below:

- `apps/api/src/deployment/deployment.service.ts` — reads the state file,
  never throws on a filesystem error, and the three reasons it reports
  instead.
- `apps/api/src/deployment/deploy-state.schema.ts` — what "not a deployment
  record" means, precisely.
- `apps/api/src/deployment/deployment.controller.ts` — `GET
  /api/admin/deployment`, `deployment:read`, and why it answers `200` even
  with nothing to report.
- `apps/web/src/pages/Admin/DeploymentPage.tsx` — the page itself, including
  its own header comment on the five sections and the three different
  "nothing to show" states.
- `infra/compose/vps.compose.yml` — the mount this page's data actually comes
  through, and its own long comment on why it is a directory, not a file.
- `apps/cli/src/deploy/state.ts` — the CLI side that writes the file this
  page reads.

---

## 1. What the page shows

Five sections, matching the order somebody actually asks these questions:

1. **Last deployment** — when it ran, `install` or `update`, which commit,
   which ref, and the state file's own schema version (relevant to section 3
   below).
2. **Serving** — the domain, the loopback port, the proxy container (or
   "Host" when there is none), and how long the certificate in front of this
   deployment has left, when the state file knows.
3. **Host** — the machine `appctl deploy` last ran on: hostname, OS, kernel,
   architecture, CPU count, memory, Docker and Compose versions, and the
   public IP when one could be determined locally (see section 4 below for
   what "locally" means, and why it is sometimes absent on purpose).
4. **This API instance** — the *container* that answered the request you're
   looking at: this process's own API version, start time and Node version,
   and its own hostname — which on Docker is the **container ID**, not the
   server's. This section is not read from the state file at all; it is
   always present, because a running process can always describe itself.
5. **History** — previous deploys, newest first, as recorded in the state
   file (capped at 20 entries).

**This page has no write of any kind, for anyone.** A deployment is changed
by running `appctl deploy` on the server, not by anything in this
application — a control here that appeared to change any of this would be
lying about what it does. That is also why this is the one Operations card
with no "(read-only)" qualifier on its subtitle: the qualifier on the other
Operations pages exists to explain a control set that *changes* with the
viewer's permissions, and nothing on this page changes with anything.

## 2. Why "not configured" is often correct, not broken

Every developer laptop, every CI run and every plain `docker compose up`
that was not driven by `appctl deploy` legitimately has no state file to
read. `GET /api/admin/deployment` answers `200` either way —
`configured: false` plus a `source.reason`, never a `404` or `503` — because
a missing state file is the *ordinary* case, not a fault, and an error
response here would make "this is a local dev box" indistinguishable from
"the admin API is broken."

Three reasons, each with a different remedy:

| `source.reason` | What it means | What to do |
|---|---|---|
| `not-found` | Nothing to read. Either `DEPLOY_STATE_FILE` is unset (this deployment was not installed by `appctl deploy`), or it is set and the path does not exist. **The ordinary case off a VPS**, and often the ordinary case *on* one too, briefly — see the timing note in section 3. | If this server genuinely was installed with `appctl deploy install`, confirm `APPCTL_DEPLOY_ROOT` in `.env` actually matches the directory `--root` pointed `install` at (section 4). If it wasn't, there is nothing to fix — this is the expected answer. |
| `unreadable` | The path exists, but this API process could not get bytes out of it — most often a permissions problem, or (see section 3) a bind mount that resolved to a *directory* rather than a file because the file did not exist yet when the container first mounted it. | Check the file's permissions and ownership on the host, and that the API container's mount actually resolves to a file, not a directory it created for itself. |
| `invalid` | Bytes were read, and they are not a deployment record — malformed JSON, an unrecognised `version`, a field of the wrong type, or a file larger than this service will read (64 KiB). Most often a file from a **newer** `appctl` than this API understands, or one edited by hand. | Confirm the CLI and the API are from compatible releases of this repository, and that nobody hand-edited `.appctl-deploy.json`. Re-running `appctl deploy update` rewrites the file cleanly. |

The "This API instance" section (2.4 above) renders regardless of which of
these applies, or whether the request even reached a state file at all —
that part is answered from the live process, not the disk.

## 3. Why the mount is the deploy root, not the state file

`infra/compose/vps.compose.yml` mounts `${APPCTL_DEPLOY_ROOT:-/opt/infra/apps}`
— the whole **directory** `appctl deploy` manages — into the `api` service
at `/var/lib/appctl`, read-only, with `DEPLOY_STATE_FILE` pointed at
`/var/lib/appctl/.appctl-deploy.json` inside it. Mounting the *file* directly
looks like the obvious version of this line, and it is wrong twice over, both
failures silent:

1. **It would break the first install.** `apps/cli/src/deploy/install.ts`
   calls `writeState(...)` *after* `runPipeline` returns — that is, after the
   stack has already been started with `docker compose up -d`, and after
   health, publish and verify have all run. So on a first install, the state
   file genuinely does not exist yet at the moment this stack's containers
   start. Docker's own response to a bind mount naming a host path that
   isn't there yet is to *create it, as a directory* — and a single-file
   mount pointed at that path would then have the API reading (or failing to
   read) a directory forever, with no install step left to fix it.
2. **It would go stale on every update.** `writeState` is deliberately
   atomic: it writes `.appctl-deploy.json.<pid>.tmp` and `renameSync`s it
   into place. A rename swaps the *inode*, and a single-file bind mount stays
   pinned to whichever inode it resolved to when the container started. The
   API container would go on reading the file from the install run, forever
   — through every subsequent `update` — until somebody restarted it. This
   page would confidently report the commit from three deploys ago and there
   would be nothing in this page's own data to say so.

Mounting the **directory** instead sidesteps both: a directory mount resolves
each lookup fresh, so a file that didn't exist yet at container start is
picked up the moment it appears, and a renamed-into-place replacement is
seen on the very next read.

**The honest consequence, stated plainly:** this also gives the API
container read-only access to the rest of the deploy root — the git
checkout `appctl deploy` manages, its install/update journals, and
`repo/infra/compose/.env`. That last one sounds like the biggest deal and
isn't: it is the *same* `.env` the container already receives in full
through `env_file` in `base.compose.yml`, so this mount grants the API
process no secret it did not already hold in its own environment. Nothing
in this application reads the checkout or the journals today — they are
simply reachable, the same way any file under a mounted directory is.

## 4. Re-pointing the mount

If `--root` was passed to `appctl deploy install`/`update` with a value
other than the default `/opt/infra/apps`, set `APPCTL_DEPLOY_ROOT` in the
deployment's `.env` to match it, then restart the `api` service so the mount
is re-resolved:

```bash
# infra/compose/.env, on the server
APPCTL_DEPLOY_ROOT=/opt/infra/apps   # match whatever --root actually was
```

```bash
cd infra/compose
docker compose -f base.compose.yml -f prod.compose.yml -f vps.compose.yml up -d api
```

An operator who never passed `--root` needs no change here — the default the
CLI uses (`/opt/infra/apps`, `DEFAULT_DEPLOY_ROOT` in
`apps/cli/src/commands/deploy.ts`) is also this overlay's own default. A
mismatch between the two is the single most common cause of a `not-found`
that shouldn't be one.

**A brief `not-found` right after a first `install` is expected, not a
bug.** Per section 3, the state file is written only after the stack is
already serving traffic; if you check this page in the handful of seconds
between "the stack is up" and "the state file landed on disk," you will see
`not-found`. It resolves itself on the very next poll — the page has no
manual refresh to reach for, only patience measured in seconds.

## 5. Summary checklist

- [ ] Confirmed whether this server was actually installed by `appctl
      deploy` before treating "not configured" as a problem
- [ ] `source.reason` read, not guessed at, before choosing a remedy — the
      three reasons in section 2 need different fixes
- [ ] `APPCTL_DEPLOY_ROOT` in `.env` matches the `--root` (or its default)
      `appctl deploy install`/`update` actually used
- [ ] `api` service restarted after changing `APPCTL_DEPLOY_ROOT`, so the
      mount is re-resolved
- [ ] A `Host`/`Serving`/`History` section that's simply absent (rather than
      shown empty) understood as "this deployment predates state file
      version 2," not as missing data — confirmed via the schema version in
      the Last deployment section
- [ ] Understood that nothing on this page can be changed from here — only
      `appctl deploy` on the server changes what it reports
