---
"@marinoscar/platform-api": minor
"@marinoscar/platform-web": minor
"@marinoscar/platform-cli": patch
---

Add the host About module and web slice: `@marinoscar/platform-api/host` now owns `GET /api/admin/about` (`AboutModule.forRoot({ apiVersion })`, `AboutService`, `readDeployInfo`, the `versions` support-bundle section; the database probe reads through `PLATFORM_PRISMA`), and `@marinoscar/platform-web/host/headless` and `/host/ui` own the About page, the admin Maintenance page, the public maintenance screen, the maintenance block store and recogniser and the `useAbout`, `useMaintenance` and `useMaintenanceBlock` hooks. The deploy-info fixture the CLI's tests read moved to `packages/platform-api/test/fixtures`.
