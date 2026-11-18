---
"@marinoscar/platform-web": minor
---

Move `MaintenanceGate`, `MaintenanceBanner`, `InstallPrompt` and `UpdatePrompt` into `@marinoscar/platform-web/host/ui` (#901). DOM and styles are unchanged; the gate and the install prompt take `appName`, and the update prompt takes vite-plugin-pwa's `useRegisterSW` as a prop.
