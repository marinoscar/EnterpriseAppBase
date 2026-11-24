---
"@marinoscar/platform-cli": patch
---

A proxy stream path can declare a WebSocket: `ProxyStreamPathRegistration.websocket` (and `ProxyExtraLocation.websocket`), validated as a boolean at `createCli`. The host-proxy location of a `websocket: true` route renders `proxy_set_header Upgrade $http_upgrade;` and `proxy_set_header Connection "upgrade";` instead of `Connection ''`, keeping HTTP/1.1, buffering off and the stream timeout, so a WebSocket route behind the edge can upgrade after `deploy install` and `deploy update`. Plain string paths render exactly as before (#1222).
