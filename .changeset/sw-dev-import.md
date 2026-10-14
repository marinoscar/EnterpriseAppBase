---
"@marinoscar/platform-web": patch
---

Add the React-free `@marinoscar/platform-web/notifications/service-worker` entry and point the reference app's `sw.ts` at it. Importing `registerNotificationServiceWorkerHandlers` from the `/headless` barrel loaded React into the service worker in Vite dev mode (nothing is tree-shaken there), which threw "window is not defined" and kept the worker from installing (#886). The barrel still re-exports the handlers.
