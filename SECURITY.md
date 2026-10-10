# Security policy

This repository is a template and the source of the `@marinoscar/platform-*` packages and container images built from it.
A vulnerability in platform code reaches every app that uses it, so report it privately.

## Supported versions

| Version | Supported |
|---|---|
| `main` branch | Yes, until the first package release |
| Latest minor release of the `@marinoscar/platform-*` packages | Yes, after the first package release |
| Previous minor release | Security fixes only, after the first package release |
| Anything older | No |

Apps are expected to stay at most one minor version behind; security patches are fast-tracked.

## Reporting a vulnerability

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability** (GitHub private vulnerability reporting).
3. Describe the issue: affected component, impact, reproduction steps and any suggested fix.

Do not open a public issue, pull request or discussion for a vulnerability.

## Response targets

These are targets, not guarantees.

| Stage | Target |
|---|---|
| Acknowledgement of your report | Within 5 business days |
| Triage decision (accepted, needs more information, declined) | Within 10 business days |
| Fix or mitigation plan for a confirmed high or critical issue | Within 30 days |

## Scope

In scope:

- This repository: the API, web app, CLI and shared code.
- The packages and container images this repository publishes.

Out of scope:

- Apps built from the template; they have their own repositories and their own policy.
- Third-party dependencies; report those to the upstream project.

## Security design

How authentication, credentials, authorization and data protection work is documented in [docs/SECURITY-ARCHITECTURE.md](docs/SECURITY-ARCHITECTURE.md).
