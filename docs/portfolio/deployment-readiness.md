# Public sandbox deployment

The sandbox is publicly available at [referral-commission-system.pages.dev](https://referral-commission-system.pages.dev). Its Railway API has a separate [health endpoint](https://refferral-commission-system-production.up.railway.app/health).

Cloudflare Pages serves the static Next.js workbench. Its same-origin `/api/*` function forwards browser requests to Railway, so the signed sandbox cookie stays first-party in the browser. Railway terminates the API's HTTPS traffic; the API trusts that one proxy hop and adds the `Secure` cookie attribute for HTTPS requests.

## Demo boundary

This is a shared, resettable sandbox. It contains only deterministic fictional data and simulated money movement. The app must continue to use `APP_MODE=sandbox`; SMS must remain in preview mode; email must remain disabled or use a private test inbox. Mailpit and PostgreSQL must never be public services.

The Docker Compose stack remains a **local demo**. Its default database password, fallback session secrets, open ports, shared demo state, and Mailpit inbox make it unsuitable for direct public exposure.

## Before adapting it for a real business

1. Set unique session, OTP HMAC, and booking-webhook secrets in managed secret storage. Set `WEB_ORIGIN` and the Pages API origin to the real HTTPS domains.
2. Isolate tenant and visitor state, or protect reset operations with an operator-controlled schedule before inviting public traffic.
3. Put rate limits and resource quotas on session creation, booking events, claims, and resets. Monitor service health, event failures, outbox failures, and database size.
4. Run CI, migrate the managed database, verify the browser journey at the hosted URL, and publish screenshots that show the sandbox and simulated-payment labels.
5. Add identity, payment reconciliation, tax, KYC, backup, monitoring, incident response, and legal review before handling real people or money.
