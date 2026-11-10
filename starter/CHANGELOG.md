# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The web app uses the platform's app shell (`@marinoscar/platform-web/shell`: the AppBar, the navigation rail on tablets and desktops, the bottom bar on phones, the user menu, the light / dark theme) and `createPlatformApiClient` from `@marinoscar/platform-web/core`, instead of a hand-built AppBar and a hand-written transport adapter. Declare your destinations in `apps/web/src/config/navigation.ts`.
