---
"@marinoscar/platform-api": patch
---

Record the `webhookDeliveryDuration` histogram for a delivery attempt that completes in 0 ms. The handler skipped the measurement when the elapsed time was zero; it now skips only when no attempt ran (the endpoint was gone or disabled before sending).
