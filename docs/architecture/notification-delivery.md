# Notification delivery

The notification subsystem keeps OTP issuance and financial transactions independent from external delivery. Preview SMS is free and local by default. Email goes to Mailpit by default. UniSMS is an explicit server-side opt-in.

For the guided workflow, see the [README](../../README.md). For claim binding and state transitions, see [Domain lifecycle and recovery ledger](domain-lifecycle.md).

## Delivery flow

```text
domain transaction
  └─ insert notification_outbox row
       └─ commit
            └─ worker leases row with SKIP LOCKED
                 ├─ local Mailpit SMTP
                 ├─ optional UniSMS HTTPS
                 └─ terminal/retry/reconciliation update
```

OTP challenge creation and notification enqueue happen in one database transaction. Provider I/O happens after commit in the in-process worker. A provider outage cannot partially create a claim, and a rolled-back challenge cannot leave a valid queued message.

## SMS modes

`SMS_DELIVERY_MODE` accepts exactly three values.

| Mode       | Browser response                                            | Outbox                                        | Network     |
| ---------- | ----------------------------------------------------------- | --------------------------------------------- | ----------- |
| `preview`  | `mode=preview` with masked recipient, message, code, expiry | `previewed`, masked recipient, `content=null` | None        |
| `unisms`   | `mode=provider`, `status=queued`; no code or message        | `pending`, then worker-managed status         | UniSMS only |
| `disabled` | HTTP 503 `channel_unavailable`                              | No challenge or outbox row                    | None        |

Preview is accepted only when `APP_MODE=sandbox`. It exercises challenge generation, binding, expiry, attempts, cooldown, verification, claim reservation, and auditing without calling a provider.

In provider mode, the OTP code never appears in the browser response. The UI shows queued or delivery status rather than a preview drawer.

## OTP content lifetime

The challenge table stores a digest, never the plaintext code. For provider delivery, plaintext remains in the outbox only while a row is pending or waiting for a retry that is known to have failed before provider acceptance.

Before every provider attempt, the worker durably changes the row to `unknown`, masks the recipient, clears `content`, and removes the lease. It retains the leased message only in process memory for the outbound request. This ordering handles an important ambiguity: if the provider accepted the request but the process lost the response, automatically sending again could deliver two OTP messages.

Outbox behavior by failure class:

- **Retryable before acceptance**, such as HTTP 429: restore the recipient and plaintext content to the pending row and schedule bounded exponential backoff, up to the attempt limit. They will be redacted again before the next attempt.
- **Terminal rejection**, such as documented validation or authentication failures: mark `failed` and keep content redacted.
- **Ambiguous result**, such as network loss or malformed success: leave `unknown` and do not resend automatically.
- **Accepted but still processing**: retain the provider reference and reconcile with status polling, without resending.
- **Terminal provider result**: mark `sent` or `failed`, keep the masked recipient, and clear content.

Workers lease rows with `FOR UPDATE SKIP LOCKED`, which allows concurrent polling without leasing the same row twice.

## UniSMS adapter

The adapter follows the official [UniSMS SMS API documentation](https://unismsapi.com/docs/sms).

It sends:

```text
POST https://unismsapi.com/api/sms
Authorization: Basic base64(API_KEY:)
Content-Type: application/json
```

The JSON body contains `recipient`, `content`, `sender_id`, and metadata with the outbox ID and dedupe key. Recipients must be E.164. Content must be 1 to 670 characters. A successful send must return HTTP 201 and a nested provider reference. Provider statuses map to neutral states:

| UniSMS                | Internal     |
| --------------------- | ------------ |
| `pending`, `retrying` | `processing` |
| `sent`                | `sent`       |
| `failed`              | `failed`     |

The worker polls `GET /api/sms/:reference_id` for accepted non-terminal messages. API keys stay in server environment variables and Basic Auth headers. Error objects do not include the key, recipient, or message content.

### Configuration

Committed examples must keep placeholders:

```dotenv
SMS_DELIVERY_MODE=unisms
UNISMS_API_KEY=replace_me
UNISMS_SENDER_ID=replace_me
UNISMS_WEBHOOK_SECRET=replace_me
UNISMS_WEBHOOK_BODY_LIMIT_BYTES=16384
```

`unisms` mode rejects a missing, blank, or `replace_me` API key or sender ID during environment parsing. Supply real values only outside version control.

## UniSMS webhook

`POST /webhooks/unisms` is public at the HTTP routing layer so the provider can reach it, but it is not unauthenticated application logic. The controller requires:

- `webhook-secret-key` equal to the configured secret, compared through fixed-length SHA-256 digests and `timingSafeEqual`;
- a non-empty `webhook-id` with a maximum length of 240;
- one supported event: `message.sent`, `message.failed`, or `message.retrying`;
- matching event and nested message status;
- matching top-level ID and provider reference;
- optional metadata `outbox_id` that is a UUID;
- a JSON body within `UNISMS_WEBHOOK_BODY_LIMIT_BYTES`, default 16,384 bytes and allowed range 256 to 65,536.

Webhook IDs are stored with a provider-wide uniqueness constraint. Replays return `duplicate` without applying the transition twice. Unknown or ambiguous references return `ignored`. Terminal outbox states are not downgraded by later events.

The local Docker workflow does not require a public webhook.

## Email modes

The two sending modes share the same Nodemailer SMTP adapter:

| Mode      | Use                                                                        |
| --------- | -------------------------------------------------------------------------- |
| `mailpit` | Default local capture at `mailpit:1025`, viewed at `http://localhost:8025` |
| `smtp`    | A configured SMTP host, port, and TLS setting                              |

`EMAIL_DELIVERY_MODE=disabled` is an availability setting rather than a sending adapter. It rejects email challenge creation before any row is queued.

Default local values:

```dotenv
EMAIL_DELIVERY_MODE=mailpit
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_SECURE=false
MAILPIT_WEB_URL=http://localhost:8025
```

Mailpit captures messages inside the Compose network. It does not forward them to the public internet. The browser never receives the email OTP from the API; the user opens the local Mailpit inbox.

## Why CI cannot send a real SMS

The real-browser suite has several independent barriers:

1. `pnpm test:e2e` stops the existing Compose project before Playwright starts.
2. Playwright starts Compose itself with `SMS_DELIVERY_MODE=preview` and every UniSMS setting forced to `replace_me`.
3. `reuseExistingServer` is false, so a server already running on port 3000 cannot be accepted silently.
4. Preview and disabled delivery tests replace server-side `fetch` with a function that rejects every network call.
5. The UniSMS test also replaces server-side `fetch`, accepts only the exact documented UniSMS endpoint, records one mocked request, and never delegates to the network.
6. The browser context aborts requests outside its isolated loopback API.
7. The test asserts preview is the only response containing a code, disabled creates no challenge or outbox row, UniSMS makes exactly one mocked request, and the browser never receives the provider code.

The Docker smoke test separately asserts that default preview mode creates no `provider='unisms'` outbox row.

## Verification

Run the full repository gate:

```bash
pnpm verify
```

Or run delivery checks directly:

```bash
pnpm test:e2e -- tests/e2e/delivery-modes.spec.ts --workers=1
node scripts/docker-smoke.mjs
```

The Playwright command manages its own Compose restart. The smoke command expects the normal Compose stack to be healthy first.

## Trade-offs

An in-process worker and PostgreSQL outbox keep local setup simple and preserve transaction boundaries. They do not provide the independent scaling, operational isolation, or long-term scheduling features of a dedicated queue system. A production deployment should run workers independently, add observability and dead-letter procedures, and define provider reconciliation policy with the selected vendor.
