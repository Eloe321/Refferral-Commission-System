# Fictional booking completion events

The home-services sandbox now has a narrow booking-to-commission path. An owner creates a fictional booking using a partner referral code. The server snapshots the selected commission rule while the earning is pending. A signed `service.completed` event changes the booking to completed and makes pending earnings eligible. Claims, simulated settlement, refunds, and recovery continue through the existing controls.

## Local demo

Open **Owner workboard → Bookings and events**. Create a booking with a fictional reference, a referral code from the partner workbench, a service category, and a value. The **Deliver completion event** button signs a sample event inside the sandbox server and passes it through the same verification and processing path as an external event. The owner can inspect the event status and retry an event that arrived before its booking.

The demo button is owner-only and sandbox-only. It does not contact a payment or booking provider. `BOOKING_WEBHOOK_SECRET` defaults to `replace_me`; the server uses a process-local random key for the demo when no explicit secret is configured.

## External test event

To connect a test sender, set `BOOKING_WEBHOOK_SECRET` to a unique value of at least 32 characters in the local environment, then restart the API container. Send `POST /webhooks/bookings` with `Content-Type: application/json` and these headers:

- `X-Booking-Timestamp`: Unix time in seconds, within five minutes of receipt.
- `X-Booking-Signature`: `sha256=` followed by lowercase hex HMAC-SHA256 of the exact bytes `timestamp + "." + raw JSON body`, keyed by `BOOKING_WEBHOOK_SECRET`.

Example JSON body:

```json
{
  "id": "fictional-provider-event-1",
  "type": "service.completed",
  "programId": "11111111-1111-4111-8111-000000000007",
  "bookingRef": "BOOKING-DEMO-1",
  "occurredAt": "2026-09-23T00:00:00.000Z"
}
```

The booking reference and program must identify an existing fictional conversion. Do not include customer names, addresses, contact details, payment data, or free-form provider payloads. The API accepts only the five documented fields and stores their sanitized values, a body hash, status, attempt count, and timestamps. It does not store the signature or webhook secret.

Invalid signatures or stale timestamps receive `401` and create no event row. A valid event for an unknown booking is recorded as `failed` with `booking_not_found`; an owner can retry it after the booking is created. Repeating the same provider event ID and body returns `duplicate` without a second transition. Reusing an event ID for different content returns `409`. A different valid event for an already completed booking is recorded as `ignored`. Processed events append a system audit record to the conversion.

When local Mailpit email is enabled, processing also queues a fictional partner confirmation in the existing durable notification outbox. The owner event list shows its pending, processing, sent, unknown, or failed status. The outbox worker handles delivery retries, while an audit record notes the queue action. No external email provider is used by the default Compose sandbox.

This is a portfolio integration seam, not a production booking or payment integration. A production adapter needs provider-specific authentication, reconciliation, tenant mapping, monitoring, and incident procedures.
