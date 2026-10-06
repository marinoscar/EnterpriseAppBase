# @marinoscar/platform-infra

Deployment configuration shipped as files: Compose fragments (`compose/`), nginx configuration (`nginx/`) and OpenTelemetry collector configuration (`otel/`), layered by an app with its own overlays. `infraFile('compose/<file>')` returns the absolute path of a shipped file, for `docker compose -f`.

## Install

```bash
npm install @marinoscar/platform-infra
```

## Peer dependencies

None.

## Status

Scaffold only (version `0.0.0`): the package builds, packs and loads, and exports nothing but its own name. Slices arrive in later releases of the platform program.

Full README per the Package documentation standard arrives with #693.
