# Case study: auditable commissions for completed home services

## Problem

A home-services business may receive jobs through partners, but paying a referral commission at booking time creates exposure when work is cancelled, incomplete, or refunded. Owners also need to explain how each amount was calculated and what happened after a claim.

## Sandbox solution

Northstar Home Services is a fictional, resettable sandbox. An owner configures a program, partner code, and commission rules, then previews the selected rule and exact commission before creating a booking. A referred booking stays pending until a signed `service.completed` event arrives. The system then makes the earning eligible; the partner authorizes a claim with a preview OTP, and the owner simulates settlement. Refunds create reversal and recovery records rather than rewriting the original settlement.

The booking provider event has a five-minute timestamp window, HMAC-SHA256 signature, durable event ID, duplicate detection, failure history, and an owner retry control. The owner workbench shows rule priority, status explanations, audit activity, and an exportable commission report. A fictional partner confirmation goes through the retryable Mailpit email outbox, with delivery state visible beside the event.

## Decisions and trade-offs

- Money stays in integer minor units and uses `bigint` for calculations.
- Specific partner rules win over category rules; category rules win over program fallback.
- One fictional organization and service-completion event keep the demo focused. The integration route is sandbox-only and is not a general production webhook platform.
- The database keeps event metadata and a request hash, not the original provider payload.
- The report exports exact minor units so spreadsheets do not round financial figures during export.

## Evidence

The repository has lint, type, unit, database integration, API E2E, privacy, browser, and Docker build checks in GitHub Actions. Browser journeys exercise the owner and partner flows. See the [booking event specification](../architecture/booking-events.md), [architecture diagram](architecture.mmd), and [walkthrough](walkthrough.md).

## Boundary

All people and bookings are fictional. SMS is previewed, email stays in a test inbox, and payouts are simulated. Real identity, KYC, tax, payment movement, reconciliation, monitoring, backups, and legal review remain separate production work.
