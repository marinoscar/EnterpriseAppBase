# Runbook: Manage outbound webhooks

> **Audience:** operators and members · **Spec:** [webhooks.md](../specs/webhooks.md) · **Admin UI:** `/settings/webhooks` (own), `/admin/settings/organization-webhooks` (organization), `/admin/settings/webhooks` (deployment) · **Permission:** `webhooks:write`, `org_webhooks:write` or `system_webhooks:write`, by scope

Use this when you connect the deployment to another system with a signed HTTP callback: register an endpoint, check that the receiver verifies the signature, rotate the secret, read the delivery log, redeliver a failure, recover an endpoint the platform switched off, or allow a receiver on a private network. Each scope has its own page and permission; the steps are the same.

## 1. Before you start

- Pick the scope. A member's `user` endpoint receives the member's own notifications; an `org` endpoint (an `org_admin`) receives organization events; a `system` endpoint (an `admin`) receives node and job events of the whole deployment.
- The receiver needs a public `https` URL (port 80, 443, 8443 or 1024 and above) that answers `2xx` within 10 seconds. A URL that resolves to a private, loopback or link-local address is refused ([§7](#7-allow-a-receiver-on-a-private-network)).
- The receiver must verify the signature over the **raw** request body and deduplicate on the `webhook-id` header. A snippet is in the [spec](../specs/webhooks.md#28-signing-rotation-and-verification).
- To forward your notifications (a `user` endpoint), also switch the **Webhooks** column on for the events you want in `/settings/notifications`.

## 2. Register an endpoint

1. Open the page for your scope and choose **Add endpoint**.
2. Enter a name, the URL, and the events: pick events from the grouped list, a whole group (`nodes.*`) or everything you are permitted (`*`).
3. Save. The one-time dialog shows the signing secret (`whsec_...`). **Copy it now**: it is never shown again, and only a rotation issues a new one.
4. Store the secret in the receiver's configuration (for example `WEBHOOK_SECRET`).
5. Press **Test**. A `webhooks.ping` delivery is queued; open the endpoint's deliveries and expect `succeeded` with the receiver's status code.

Expect `422 WEBHOOK_URL_FORBIDDEN` for a non-public target, `WEBHOOK_EVENT_NOT_PERMITTED` for an event your permissions do not allow, and `WEBHOOK_LIMIT_REACHED` past 20 endpoints per member, 50 per organization or 50 per deployment.

## 3. Verify signatures at the receiver

1. Read the raw body bytes before any JSON parsing.
2. Call `verifyWebhookSignature({ secrets, id, timestamp, body, signatureHeader })` from `@marinoscar/platform-contract/webhooks` with the `webhook-id`, `webhook-timestamp` and `webhook-signature` headers. It accepts a timestamp within 300 seconds and any of the secrets.
3. Answer `400` when it returns `false`; otherwise skip an id you have seen, handle the event and answer `2xx`.

To check by hand, the signature is `base64(HMAC-SHA256(secret bytes, "<webhook-id>.<webhook-timestamp>.<body>"))`, where the secret bytes are the base64 part after `whsec_`.

## 4. Rotate a secret

1. Open the endpoint and choose **Rotate secret**, then confirm.
2. Copy the new secret from the one-time dialog. The page shows when the previous secret stops signing (24 hours by default).
3. Until then every delivery carries two signatures in `webhook-signature`, so a receiver holding either secret verifies. Pass both secrets to `verifyWebhookSignature` while you switch.
4. Deploy the new secret at the receiver. Nothing else is needed; the old secret expires on its own.

## 5. Read the delivery log and redeliver

1. Open the endpoint; the table lists its deliveries (filter by status or event). Open a row for the exact body that was sent, the attempt count, the receiver's status, the first 1 KiB of its answer and an error code.
2. Read the status: `pending` and `delivering` are in flight; `failed` will retry (30 s, 2 m, 10 m, 30 m, 1 h, 2 h, 4 h, 6 h, 6 h); `dead` is final; `succeeded` is done. Error codes: `http_4xx`, `http_5xx`, `timeout`, `network`, `ssrf_blocked`, `http_410`, `secret_missing`.
3. After fixing the receiver, press **Redeliver** on a `dead` delivery. The same delivery is reset and queued again with the same `webhook-id`, so a receiver that deduplicates sees a repeat.
4. Deliveries are kept 30 days.

Redelivery is refused (409) while the endpoint is disabled; enable it first ([§6](#6-recover-a-disabled-endpoint)).

## 6. Recover a disabled endpoint

The platform switches an endpoint off and tells its owner (email and bell). The endpoint's `disabledReason` says why:

| Reason | Cause | Fix |
|---|---|---|
| `circuit_open` | 20 failed attempts in a row | Fix the receiver, then enable the endpoint. Enabling resets the failure count |
| `gone` | The receiver answered `410 Gone` | The receiver asked to be removed. Delete the endpoint, or point it at a live URL and enable it |
| `owner_lost_access` | The owner no longer holds the permission or the membership the event needs | Restore the access, or recreate the endpoint under an account that has it, then enable |

After enabling, press **Test** and expect `succeeded`.

## 7. Allow a receiver on a private network

By default a target must resolve only to public addresses; this is the defence against using the server to reach internal services. An on-premises deployment whose receiver is internal has two options, both **code options** of `WebhooksModule.forRoot` in `apps/api/src/platform/webhooks/webhooks.config.ts` (there is no environment variable or setting):

1. Preferred: `allowedHosts: ['hooks.internal.example.test']` exempts exactly that host name from the address check.
2. Broad: `allowPrivateTargets: true` allows any private target and ports below 1024. Use it only on a deployment with no untrusted endpoint owners.

Rebuild and restart the API, then create the endpoint and press **Test**. `allowInsecureHttp: true` additionally allows `http:` and is for development only.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Create answers `422 WEBHOOK_URL_FORBIDDEN` | `http`, userinfo, a port below 1024, or a non-public address | Use a public `https` URL, or [§7](#7-allow-a-receiver-on-a-private-network) |
| Deliveries are `dead` with `ssrf_blocked` | The name resolves to a non-public address at send time (checked on every attempt) | Fix the DNS record, or use `allowedHosts` |
| The receiver rejects every signature | It parsed and re-serialized the body, used the wrong secret, or its clock is off by more than 5 minutes | Verify the raw body; use the current secret; fix the clock |
| Deliveries stay `pending` | The job queue is not running | Check Jobs (`webhooks.deliver`) and the Doctor |
| A notification never arrives | The event lacks the `webhook` channel, the Webhooks column is off in your preferences, or no enabled user endpoint subscribes to `notification.<key>` | Check each in turn |
| Every attempt is `timeout` | The receiver takes more than 10 s | Acknowledge with `2xx` first and process after |
| The 410 disabled it by mistake | The receiver returned 410 for a path it moved | Fix the receiver, enable the endpoint |

## 9. Summary checklist

- [ ] Scope and permission chosen; receiver URL is public `https`
- [ ] Endpoint created, secret copied and stored at the receiver
- [ ] Test delivery `succeeded`; the receiver verifies the raw body and deduplicates on `webhook-id`
- [ ] Rotation: new secret copied, both secrets accepted during the overlap, old one left to expire
- [ ] A disabled endpoint's reason read, the cause fixed, the endpoint enabled and tested
- [ ] Private receiver: `allowedHosts` set in code and the API redeployed

## See also

- [Spec](../specs/webhooks.md), [slice README](../../packages/platform-api/src/webhooks/README.md)
- [Data retention](data-retention.md), [Admin guide: Webhooks](../ADMIN-GUIDE.md#webhooks)
