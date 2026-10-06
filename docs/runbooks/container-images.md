# Runbook: Container images

The api, web, worker and stack-agent images are published to GitHub Container Registry (GHCR), each with an SBOM and SLSA provenance attestation, a keyless cosign signature and a vulnerability scan. Use this runbook to find an image and its tags, to verify an image before you run it, to pin a consumer app's worker or stack-agent to its platform version, and for the one-time owner step that makes the packages public.

Audience: repository owners and maintainers (publishing), operators and consumer-app maintainers (pulling and verifying).

Source of truth for every claim below:

- `.github/workflows/images.yml`: the reusable workflow that builds, pushes, attests, signs and scans the four images.
- `.github/workflows/deploy.yml`: app releases (`v*` tags) call it with the app tag scheme.
- `.github/workflows/release.yml`: platform releases call it with the platform version and channel (the release procedure is `docs/runbooks/release-platform-packages.md`).
- `apps/api/test/images-workflow.spec.ts`: the tripwire that fails if the SBOM, provenance, signature or tag rules are removed.

---

## 1. The images

Every image is `ghcr.io/<owner>/<repo>-<role>`, where `<owner>` and `<repo>` are this repository's owner and name, **lower-cased** (OCI references must be lower-case). The workflow derives them from the repository it runs in, so a fork publishes under its own name with no edit. For the upstream template, the prefix is `ghcr.io/marinoscar/enterpriseappbase-`.

| Role | Image | Built from | What it is |
|---|---|---|---|
| api | `ghcr.io/<owner>/<repo>-api` | `apps/api/Dockerfile` (stage `production`) | The NestJS API |
| web | `ghcr.io/<owner>/<repo>-web` | `apps/web/Dockerfile` (stage `production`) | nginx serving the built React app |
| worker | `ghcr.io/<owner>/<repo>-worker` | `apps/cli/Dockerfile`, target `production` | A worker node (`appctl node start`), see [run-worker-nodes.md](run-worker-nodes.md#4-run-a-fleet-in-containers) |
| stack-agent | `ghcr.io/<owner>/<repo>-stack-agent` | `apps/stack-agent/Dockerfile` | The VPS sidecar that holds the Docker socket, see [deploy-to-vps.md](deploy-to-vps.md) |

All four are built for `linux/amd64` from the repository root as the build context, and carry the labels `org.opencontainers.image.source`, `.revision`, `.version`, `.title` and `.licenses=MIT`.

## 2. Tags and channels

There are two tag schemes, chosen by the caller.

| Built by | Tags pushed |
|---|---|
| A platform release (`release.yml`, `version` and `channel` inputs, from `main`) | `<version>` (for example `0.1.0-next.3`), the channel tag (`next` or `latest`) and `sha-<short sha>` |
| An app release (`deploy.yml`, a `v*` tag) | `<major>.<minor>.<patch>`, `<major>.<minor>`, the bare `<short sha>`, and `latest` for a stable version (as before images.yml existed) |
| `deploy.yml` run by hand from `main` | the bare `<short sha>` and `latest` |
| `images.yml` run by hand with no version | `sha-<short sha>` only |
| `images.yml` run by hand from `main` with a version (and optionally a channel) | `<version>`, the channel tag if given, `sha-<short sha>` |

The rules the workflow enforces before it builds anything:

- `latest` is pushed by the platform scheme only for an explicit `channel: latest`, and never for a prerelease version (one with a `-` part).
- A channel tag needs a version.
- Version and channel tags are pushed from `main` only. A run on any other branch pushes `sha-<short sha>` and nothing else.
- `version` must be semver without a leading `v`.

What each tag means to a consumer:

| Tag | Moves? | Use it for |
|---|---|---|
| `<version>` | Not by design: a version is released once (treat a re-push as an incident, and pin by digest where it matters) | Pinning to a platform release |
| `next` | Yes, on every platform prerelease | Trying the prerelease channel |
| `latest` | Yes, on every stable release | Quick starts only, never production |
| `sha-<short sha>`, bare `<short sha>` | No | Pinning to an exact commit |
| `@sha256:<digest>` | Never: it is the content | Production pins; what the signature covers |

## 3. How images are built

`images.yml` has no push or tag trigger of its own; nothing it does runs on an ordinary merge to `main`. It runs when:

- **A platform release publishes** (`release.yml`'s `images` job, `version` = the published version, `channel: next`).
- **An app release is tagged** (`git tag v1.4.2 && git push origin v1.4.2` runs `deploy.yml`, whose `build-and-push` job calls `images.yml` with `app-release: true`).
- **Someone runs it by hand**: Actions, *Images*, *Run workflow*, pick the branch, and leave `version` empty for a `sha-` build. From the CLI: `gh workflow run images.yml --ref <branch>`.

Each run builds the four images in parallel (a matrix with `fail-fast: false`, so one broken Dockerfile does not cancel the others). Per image it:

1. pushes the image with a BuildKit **SBOM** (SPDX) and **SLSA provenance** (`mode=max`) attached to the image index;
2. signs the pushed **digest** with `cosign sign` (keyless: the job's GitHub OIDC token, a short-lived Fulcio certificate, the signature logged in Rekor; no key exists to leak or rotate);
3. scans the digest with Trivy and uploads the SARIF report to code scanning as category `image-<role>`;
4. writes the digest, the tags and an anonymous-pull check to the run's summary.

The only credential is the workflow's `GITHUB_TOKEN`, with `packages: write`, `id-token: write` and `security-events: write` on the image job only.

## 4. Owner step: make the packages public

GHCR creates a container package as **private** on its first push. The workflow's `GITHUB_TOKEN` owns the package it created, so pushes and signatures keep working while it is private; only an anonymous `docker pull` fails. Each run's summary says which: "Anonymous pull: works", or a warning that names the package's settings page.

After the first successful run (a manual run on a branch is enough; it pushes `sha-` tags only), for each of `<repo>-api`, `<repo>-web`, `<repo>-worker` and `<repo>-stack-agent`:

1. Open `https://github.com/users/<owner>/packages/container/<repo>-<role>/settings` (for an organization: `https://github.com/orgs/<owner>/packages/container/<repo>-<role>/settings`).
2. *Danger Zone*, *Change visibility*, **Public**.
3. *Manage Actions access*: make sure this repository has **Write** (or *Inherit access from source repository* is on), so later runs can push.

Re-run the workflow, or pull anonymously, to confirm:

```bash
docker logout ghcr.io
docker pull ghcr.io/<owner>/<repo>-worker:sha-<short sha>
```

A fork that wants its images private skips this step and gives its hosts a pull credential (`docker login ghcr.io` with a token that has `read:packages`).

## 5. Verify a signature

Any machine with [cosign](https://docs.sigstore.dev/cosign/system_config/installation/) 2.x or later. `REPO` is `<owner>/<repo>` **as GitHub spells it** (the certificate carries the canonical case, and the match is case-sensitive); the image name is the lower-case one.

```bash
REPO='<owner>/<repo>'                                    # e.g. the value of repoSlug in packages/shared/identity.json
IMAGE='ghcr.io/<owner>/<repo>-api'                       # lower-case
DIGEST=$(docker buildx imagetools inspect "$IMAGE:<tag>" --format '{{ .Manifest.Digest }}')

cosign verify "$IMAGE@$DIGEST" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp "^https://github.com/${REPO}/\.github/workflows/images\.yml@"
```

The identity is always `images.yml`, whichever workflow called it: GitHub issues the certificate to the reusable workflow that ran. The part after `@` is the caller's ref, so to accept only images built from `main` (platform releases) or from a release tag (app releases), tighten the regexp to `images\.yml@refs/heads/main$` or `images\.yml@refs/tags/v`.

A successful verify prints the claims, including the commit (`githubWorkflowSha`) and the workflow run that signed it. "no matching signatures" means a wrong digest, a wrong identity (most often the case of `REPO`), or an image that was not built by this workflow.

Verify the **digest**, and deploy the digest you verified. A tag can be moved after you check it; a digest cannot.

## 6. Read the SBOM and provenance

Both are BuildKit attestations stored in the image index, next to the image manifest. The signature in section 5 covers the index digest, and the index lists the attestation manifests by digest, so a verified digest also pins its SBOM and provenance.

```bash
docker buildx imagetools inspect "$IMAGE@$DIGEST" --format '{{ json .SBOM }}'        # SPDX document
docker buildx imagetools inspect "$IMAGE@$DIGEST" --format '{{ json .Provenance }}'  # SLSA provenance
```

The SBOM lists every OS package and npm package in the final image. The provenance records the source repository and commit, the Dockerfile, the build arguments (`VERSION`) and the workflow run that built it. Both are non-empty for every image the workflow pushes; an empty result means the image was built some other way.

## 7. Vulnerability scan results

The Trivy report for each image is under the repository's *Security*, *Code scanning*, filtered by tool **Trivy** and category `image-api`, `image-web`, `image-worker` or `image-stack-agent`. Only vulnerabilities with a fixed version available are reported (`ignore-unfixed`).

The scan is **report-only for now**: a finding, a failed scan (for example a rate-limited vulnerability database download) or a failed upload (code scanning is unavailable on a private repository without GitHub Advanced Security) never fails the build. Making it a gate is a later decision, once the baseline is triaged. To triage a finding, check whether it comes from the base image (`node:24-alpine`, rebuilt upstream: re-run the workflow) or from an npm dependency (upgrade it in the repository).

## 8. Pin a worker or stack-agent to your platform version

A consumer app built on the `@marinoscar/platform-*` packages runs the worker and stack-agent images from the **platform** release that matches its packages, not from its own repository. The platform packages share one version, so read it from any of them:

```bash
node -p "require('@marinoscar/platform-api/package.json').version"     # e.g. 0.1.0-next.3
```

**Worker.** `infra/compose/worker.compose.yml` takes the image from `WORKER_IMAGE`. Set it in `.env.worker` to the platform version, or better, to the digest you verified (section 5):

```bash
WORKER_IMAGE=ghcr.io/<owner>/<repo>-worker:0.1.0-next.3
# or, immutable:
WORKER_IMAGE=ghcr.io/<owner>/<repo>-worker@sha256:<digest>
```

`<owner>/<repo>` here is the **platform's** repository (the upstream template), lower-cased. Change the pin in the same pull request that bumps the platform packages, so the app and its workers move together.

**stack-agent.** `vps.compose.yml` builds the stack-agent from source on the server. To run the published image instead, layer the overlay in [deploy-to-vps.md, "Use the published stack-agent image"](deploy-to-vps.md#61-use-the-published-stack-agent-image) with the same version or digest.

A reference app (this repository itself) needs none of this: its own `deploy.yml` images and its own source are the same commit.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A push fails with `denied: permission_denied` or 403 | The package exists but this repository has no write access to it (created by another workflow, another repository or by hand) | The package's settings, *Manage Actions access*: give this repository **Write** (section 4, step 3) |
| `docker pull` fails with `unauthorized` or `denied` while signed in to nothing | The package is still private | Section 4 |
| The run summary warns "is not public" | The same | Section 4; the warning is informational and the run is green |
| `images.yml` fails at "Plan the image and its tags" | A refused input: a channel without a version, a version or channel off `main`, `latest` on a prerelease, a non-semver version | Read the `::error` line; run from `main` or drop the version |
| `cosign verify`: "no matching signatures" | Wrong digest, or `REPO` not in GitHub's exact case | Re-read the digest from the tag; copy `REPO` from the repository URL |
| `cosign verify`: certificate identity mismatch | The image was built by a different workflow (for example a fork's) | Verify against that repository's identity, or do not run the image |
| No Trivy results in code scanning | The scan or the upload failed (non-blocking) | The job log of the "Scan for vulnerabilities" or "Upload the scan" step |

## Summary checklist

**Publishing (owner, once)**

- [ ] A manual run of *Images* on a branch is green and its summary lists four signed digests
- [ ] The four packages are public, with Actions write access for this repository (section 4)
- [ ] A re-run's summary says "Anonymous pull: works" for all four

**Consuming**

- [ ] The image is pinned by version or, for production, by digest
- [ ] `cosign verify` passes for that digest with the `images.yml` identity
- [ ] The worker (`WORKER_IMAGE`) and stack-agent pins match the app's platform package version
